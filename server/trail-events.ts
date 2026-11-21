// The bot's side of the trail, read off the runtime bus: turns, tool calls (name, what host or app they touched, how long,
// how they ended; never their arguments or output), the cards that ask the person, waits for a computer, and engine
// errors. A turn a person's send started carries that send's trail id (cid), so the app's trail and this one meet.
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import { toolName } from "../electron/trail.mjs";
import { trail, trailError } from "./trail.ts";

const MAX_OPEN = 2000;
const CID_TTL_MS = 2 * 60_000;

/** a host or app name a tool call worked on, when its target is one; a file path or free text is never kept */
export function toolTarget(target: string | undefined): string | undefined {
  if (!target) return undefined;
  const text = target.trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return new URL(text).host || undefined;
  } catch { /* not an address */ }
  if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{1,5})?$/i.test(text) && !/\.(?:m?[jt]sx?|json|md|txt|py|sh|log|csv|png|jpe?g|pdf|html?|css)$/i.test(text)) return text.toLowerCase();
  return undefined;
}

/** the name a tool call is logged under: the engine's tool name ("Bash", "browser_open"), "shell" when the engine's
 * title is the command itself, else its activity; never the title's text, a command or its arguments */
export function loggedToolName(title: string | undefined, summary: string | undefined, activity: string | undefined): string {
  const name = toolName(title);
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  if (summary && (!name || (title && flat(summary).startsWith(flat(title))))) return "shell";
  return name ?? toolName(activity) ?? "tool";
}

/** the computer or browser a wait was for, without its id: "computer", "browser" */
const resourceKind = (resource: string) => resource.split(":")[0]?.slice(0, 20);

export function traceRuntimeEvents(bus: { subscribe(listener: (event: RuntimeEvent) => void): unknown }, ownerOf: (threadId: string) => string | undefined): {
  /** a person's send (POST /api/bots/<id>/messages) named itself: the turn it starts carries the same id */
  sendNamed(owner: string, cid: string): void;
} {
  const turns = new Map<string, { at: number; cid?: string }>();
  const tools = new Map<string, { at: number; tool: string; target?: string; activity?: string }>();
  const named = new Map<string, { cid: string; at: number }>();
  const trimmed = <K, V>(map: Map<K, V>) => { if (map.size > MAX_OPEN) map.delete(map.keys().next().value as K); };

  bus.subscribe((event) => {
    try {
      const bot = ownerOf(event.threadId);
      const base = { bot, thread: event.threadId, turn: event.turnId };
      switch (event.type) {
        case "turn.started": {
          const send = bot ? named.get(bot) : undefined;
          const cid = send && Date.now() - send.at < CID_TTL_MS ? send.cid : undefined;
          if (bot && cid) named.delete(bot);
          turns.set(`${event.threadId}:${event.turnId ?? ""}`, { at: Date.now(), cid });
          trimmed(turns);
          trail("bot.turn.start", { ...base, provider: event.provider, ...(cid ? { cid } : {}) });
          break;
        }
        case "turn.completed": {
          const key = `${event.threadId}:${event.turnId ?? ""}`;
          const open = turns.get(key);
          turns.delete(key);
          trail("bot.turn.end", { ...base, ok: event.ok, stop: event.stopReason ?? undefined, ms: open ? Date.now() - open.at : undefined, ...(open?.cid ? { cid: open.cid } : {}), denials: event.denials?.length || undefined });
          break;
        }
        case "turn.retrying":
          trail("bot.turn.retry", { ...base, attempt: event.attempt, delayMs: event.delayMs, reason: event.reason });
          break;
        case "turn.wait_started":
          trail("bot.turn.wait", { ...base, resource: resourceKind(event.resource), position: event.position });
          break;
        case "turn.wait_ended":
          trail("bot.turn.waited", { ...base, resource: resourceKind(event.resource), outcome: event.outcome, ms: event.waitedMs });
          break;
        case "item.started":
          if (event.itemType === "tool" && event.itemId) {
            tools.set(`${event.threadId}:${event.itemId}`, { at: Date.now(), tool: loggedToolName(event.title, event.summary, event.step?.activity), target: toolTarget(event.step?.target), activity: event.step?.activity });
            trimmed(tools);
          }
          break;
        case "item.completed":
          if (event.itemType === "tool" && event.itemId) {
            const key = `${event.threadId}:${event.itemId}`;
            const open = tools.get(key);
            tools.delete(key);
            trail("bot.tool", { ...base, tool: open?.tool ?? "tool", ...(open?.target ? { host: open.target } : {}), ...(open?.activity ? { activity: open.activity } : {}), ok: event.ok, ms: open ? Date.now() - open.at : undefined });
          }
          break;
        case "request.opened":
          trail("bot.card.shown", { ...base, kind: event.requestType, tool: loggedToolName(event.tool, event.commandLine ?? event.command?.command, undefined), request: event.requestId });
          break;
        case "request.resolved":
          trail("bot.card.resolved", { ...base, request: event.requestId });
          break;
        case "runtime.error":
          trailError("bot.runtime", (event as { message?: string }).message ?? "", base);
          break;
        case "session.exited":
          trail("bot.session.exit", { ...base, reason: event.reason });
          break;
        case "cap.exhausted":
          trail("bot.turn.cap", { ...base });
          break;
        default:
          break;
      }
    } catch { /* the trail never breaks the bus */ }
  });

  return {
    sendNamed(owner, cid) {
      named.set(owner, { cid, at: Date.now() });
      trimmed(named);
    },
  };
}
