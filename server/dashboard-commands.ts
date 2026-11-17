import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { appSlug, commandPairLink, commandUrl } from "../shared/dashboard-protocol.ts";
import type { CompanionEndpoint } from "../shared/pairing-link.ts";
import type { CommandResult, DashboardCommand } from "../shared/dashboard-protocol.ts";
import type { createDashboardCollector } from "./dashboard-report.ts";
import type { RequestAuth } from "./request-auth.ts";

/** an app's own failure (Composio's answer, a refused sign-in) is worth showing as it is: one short line with no link,
 *  address or stack in it. anything else stays "could not complete" */
export function plainError(message: string): boolean {
  const text = message.trim();
  return text.length > 0 && text.length <= 240 && !/[\r\n]|https?:\/\/|\bat [\w.<>]+ \(|[A-Za-z]:\\|\/(?:home|root|usr|data|var|tmp)\//.test(text);
}

/** `companion`: the Mac companion's addresses while it already runs and policy allows remote access, else null; a phone
 *  pairing never starts it */
export function createDashboardCommands(deps: { port: number; collect: ReturnType<typeof createDashboardCollector>; fetch?: typeof fetch; companion?: () => Promise<CompanionEndpoint[] | null> }) {
  const pending = new Map<string, { path: string; method: string }>();
  const owners = new WeakSet<RequestAuth>();
  function authenticate(req: IncomingMessage): RequestAuth | null {
    const key = req.headers["x-dusk-dashboard-command"];
    const grant = typeof key === "string" ? pending.get(key) : undefined;
    if (!grant || !["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(req.socket.remoteAddress ?? "") || req.method !== grant.method || req.url !== grant.path) return null;
    pending.delete(key as string);
    // only this process can mint a one-use owner grant for the exact command route.
    const auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
    owners.add(auth);
    return auth;
  }
  /** a one-use owner grant for exactly this loopback call */
  async function call(path: string, method: string, body: object): Promise<Response> {
    const nonce = randomBytes(32).toString("base64url");
    pending.set(nonce, { path, method });
    try {
      return await (deps.fetch ?? fetch)(`http://127.0.0.1:${deps.port}${path}`, { method, redirect: "error", signal: AbortSignal.timeout(55_000),
        headers: { "content-type": "application/json", "x-dusk-dashboard-command": nonce }, ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }) });
    } finally { pending.delete(nonce); }
  }
  /** a phone signed in to this workspace's own account asked to link: the same grant the pairing qr carries, for its owner */
  async function pairPhone(command: DashboardCommand): Promise<CommandResult> {
    const result = (ok: boolean, message: string, extra: Partial<CommandResult> = {}): CommandResult => ({ id: command.id, ok, message, at: Date.now(), ...extra });
    try {
      const companion = await deps.companion?.().catch(() => null) ?? null;
      const response = await call("/api/mobile/pairing", "POST", { label: command.target.slice(0, 60), ...(companion?.length ? { companion } : {}) });
      const answer = await response.json().catch(() => ({})) as { link?: unknown; code?: unknown };
      if (response.ok) {
        const link = commandPairLink(answer.link);
        return link ? result(true, "Phone pairing is ready.", { link }) : result(false, "The workspace made no pairing link.", { reason: "refused" });
      }
      if (response.status === 409 && answer.code === "unreachable") return result(false, "A phone cannot reach this workspace yet.", { reason: "unreachable" });
      return result(false, "The workspace refused the phone pairing.", { reason: "refused" });
    } catch { return result(false, "The workspace could not complete this action.", { reason: "refused" }); }
  }
  async function execute(command: DashboardCommand): Promise<CommandResult> {
    if (command.kind === "phone.pair") return pairPhone(command);
    const result = (ok: boolean, message: string): CommandResult => ({ id: command.id, ok, message, at: Date.now() });
    let path: string, method: string, message: string, body: object = {};
    const target = encodeURIComponent(command.target);
    if (command.kind === "computer.wake" || command.kind === "computer.sleep") {
      const bot = deps.collect.bots().find((bot) => bot.id === command.target);
      if (!bot || !bot.computer) return result(false, "This bot's computer could not be found.");
      const wake = command.kind === "computer.wake";
      path = `/api/bots/${target}/${bot.computer === "local-vm" ? `local-computer/${wake ? "start" : "stop"}` : `computer/${wake ? "provision" : "sleep"}`}`;
      method = "POST"; message = `${bot.name}'s computer is ${wake ? "waking up" : "asleep"}.`;
    } else if (command.kind === "phone.revoke") {
      const phone = (await deps.collect.devices()).phones.find((phone) => phone.id === command.target);
      if (!phone) return result(false, "This phone could not be found.");
      if (command.target.startsWith("phone:")) path = `/api/phones/${encodeURIComponent(command.target.slice(6))}`;
      else if (command.target.startsWith("mobile:")) path = `/api/mobile/devices/${encodeURIComponent(command.target.slice(7))}`;
      else return result(false, "This phone's registration could not be found.");
      method = "DELETE"; message = `Revoked ${phone.label}.`;
    } else if (command.kind === "session.revoke") {
      const session = (await deps.collect.devices()).sessions.find((session) => session.id === command.target);
      if (!session) return result(false, "This session could not be found.");
      path = `/api/auth/sessions/${target}`; method = "DELETE"; message = `Revoked ${session.label}.`;
    } else if (command.kind === "routine.pause" || command.kind === "routine.resume") {
      const routine = deps.collect.bots().flatMap((bot) => bot.routines).find((routine) => routine.id === command.target);
      if (!routine) return result(false, "This routine could not be found.");
      const enabled = command.kind === "routine.resume";
      path = `/api/routines/${target}`; method = "PATCH"; body = { enabled }; message = `${enabled ? "Resumed" : "Paused"} ${routine.name}.`;
    } else if (command.kind === "app.connect" || command.kind === "app.disconnect") {
      const slug = appSlug(command.target);
      if (!slug) return result(false, "This app could not be found.");
      const connect = command.kind === "app.connect";
      path = `/api/connectors/${encodeURIComponent(slug)}${connect ? "/authorize" : ""}`;
      method = connect ? "POST" : "DELETE"; message = connect ? "Sign-in is ready." : "Disconnected.";
    } else return result(false, "This dashboard command is not supported.");
    try {
      const response = await call(path, method, body);
      if (!response.ok) {
        const answer = await response.json().catch(() => ({})) as { error?: unknown };
        const shown = typeof answer.error === "string" && (response.status < 500 || (command.kind.startsWith("app.") && plainError(answer.error)));
        return result(false, shown ? (answer.error as string).trim() : "The workspace could not complete this action.");
      }
      if (command.kind !== "app.connect") return result(true, message);
      const url = commandUrl((await response.json().catch(() => ({})) as { url?: unknown }).url);
      return url ? { ...result(true, message), url } : result(false, "This app did not return a sign-in page.");
    } catch { return result(false, "The workspace could not complete this action."); }
  }
  return { execute, authenticate, owns: (auth: RequestAuth) => owners.has(auth) };
}
