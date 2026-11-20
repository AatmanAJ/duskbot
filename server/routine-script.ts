// A routine's script check (RoutineProbe kind "script"): one command line run without any AI, its output compared
// with the last run's. Only dusk bot's base environment reaches it, never its keys.
import { spawn } from "node:child_process";
import { homedir } from "node:os";

export const SCRIPT_TIMEOUT_MS = 60_000;
export const SCRIPT_OUTPUT_MAX = 64 * 1024;
const BASE_NAMES = ["PATH", "LANG", "LANGUAGE", "LC_ALL", "TZ", "TERM", "USER", "LOGNAME", "SHELL", "TMPDIR", "SSL_CERT_FILE", "SSL_CERT_DIR"];

export type ScriptResult = { ok: true; output: string } | { ok: false; error: string };

/** What a script's output asks for: `false` keeps the run asleep, `true` wakes it whatever changed, undefined compares. */
export function wakeAsked(output: string): boolean | undefined {
  const last = output.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
  if (!last.startsWith("{")) return undefined;
  try {
    const value = JSON.parse(last) as unknown;
    const wake = value && typeof value === "object" && !Array.isArray(value) ? (value as { wakeAgent?: unknown }).wakeAgent : undefined;
    return typeof wake === "boolean" ? wake : undefined;
  } catch {
    return undefined;
  }
}

export function runCheckScript(command: string, options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number } = {}): Promise<ScriptResult> {
  const source = options.env ?? process.env;
  const env: Record<string, string> = { HOME: source.HOME ?? homedir() };
  for (const name of BASE_NAMES) if (source[name]) env[name] = source[name]!;
  const windows = process.platform === "win32";
  return new Promise((resolve) => {
    let out = "", err = "", settled = false;
    const done = (result: ScriptResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const child = spawn(windows ? "cmd.exe" : "/bin/sh", windows ? ["/d", "/s", "/c", command] : ["-c", command], {
      cwd: options.cwd ?? env.HOME, env, stdio: ["ignore", "pipe", "pipe"], detached: !windows, windowsHide: true,
    });
    const kill = () => { try { if (!windows && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* already gone */ } };
    const timer = setTimeout(() => { kill(); done({ ok: false, error: `The script ran longer than ${Math.round((options.timeoutMs ?? SCRIPT_TIMEOUT_MS) / 1000)} seconds.` }); }, options.timeoutMs ?? SCRIPT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => { if (out.length < SCRIPT_OUTPUT_MAX) out += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { if (err.length < 2_000) err += chunk.toString("utf8"); });
    child.on("error", (error) => done({ ok: false, error: `The script could not start: ${error.message}` }));
    child.on("close", (code) => {
      if (code === 0) return done({ ok: true, output: out.slice(0, SCRIPT_OUTPUT_MAX) });
      const why = err.trim().split(/\r?\n/).at(-1)?.slice(0, 300);
      done({ ok: false, error: `The script stopped with exit code ${code ?? "unknown"}${why ? `: ${why}` : "."}` });
    });
  });
}

export const SCRIPT_REFUSALS = {
  cloud: "Script checks run only on the person's own computer, not on dusk cloud. Use a page, feed or price check instead.",
  notPerson: "Only the person can have you set up a script check, in their own chat with you; work from a routine, an outside event, a room or another bot cannot. Use a page, feed or price check, or ask them.",
  owner: "Only this computer's owner can set up a script check.",
  asksFirst: "This bot asks before every action, so a script cannot run on its own. Use a page, feed or price check, or ask the person to change the bot's level.",
} as const;

/** Why this turn may not give a routine a script check; null when it may. A script check runs a command with no AI and
 * no card, so only the owner's own request at a level that runs commands unasked may set one. */
export function scriptCheckRefusal(turn: { owned: boolean; room: boolean; guest: boolean; depth: number; handedOff: boolean; outsideDriven: boolean; routineRun: boolean; personStarted: boolean; asksFirst: boolean }, cloudHome: boolean): string | null {
  if (cloudHome) return SCRIPT_REFUSALS.cloud;
  if (!turn.owned || turn.room || turn.guest || turn.depth > 0 || turn.handedOff || turn.outsideDriven || turn.routineRun || !turn.personStarted) return SCRIPT_REFUSALS.notPerson;
  return turn.asksFirst ? SCRIPT_REFUSALS.asksFirst : null;
}

/** A routine, a change to one or a trigger request that sets a script check. */
export function setsScript(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { probe?: { kind?: unknown } | null; routine?: unknown; changes?: unknown };
  return record.probe?.kind === "script" || setsScript(record.routine) || setsScript(record.changes);
}
