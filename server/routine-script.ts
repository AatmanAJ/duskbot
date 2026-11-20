// A routine's script check (RoutineProbe kind "script"): one command line run without any AI, its output compared
// with the last run's. Only dusk bot's base environment reaches it, never its keys; on macOS it runs under sandbox-exec,
// writing only to a scratch folder and reading none of the person's keys.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

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

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
/** Under HOME: what a script check may never read. */
const PRIVATE_READS = [".ssh", ".gnupg", ".aws", ".config/duskbot", ".duskbot", ".netrc", "Library/Keychains", "Library/Cookies"];
const quoted = (path: string) => JSON.stringify(path);

/** The macOS sandbox profile (sandbox-exec, Seatbelt SBPL): everything allowed but writes outside `scratch` and reads
 * of the person's keys. Network stays open: a check reads pages and APIs. */
export function sandboxProfile(scratch: string, home: string): string {
  return [
    "(version 1)", "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${quoted(scratch)}) (literal "/dev/null") (literal "/dev/zero") (regex #"^/dev/(fd/|tty|stdout|stderr)"))`,
    `(deny file-read* ${PRIVATE_READS.map((part) => `(subpath ${quoted(join(home, part))})`).join(" ")})`,
  ].join("\n");
}

export function runCheckScript(command: string, options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number; sandbox?: boolean } = {}): Promise<ScriptResult> {
  const source = options.env ?? process.env;
  const env: Record<string, string> = { HOME: source.HOME ?? homedir() };
  for (const name of BASE_NAMES) if (source[name]) env[name] = source[name]!;
  const windows = process.platform === "win32";
  // an app opened from the Dock or Finder gets launchd's short PATH, without Homebrew's tools
  if (!windows) env.PATH = [...new Set([...(env.PATH ?? "").split(":").filter(Boolean), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(":");
  const boxed = (options.sandbox ?? true) && process.platform === "darwin" && existsSync(SANDBOX_EXEC);
  let scratch: string | undefined;
  if (boxed) {
    scratch = join(tmpdir(), "dusk-script-checks");
    mkdirSync(scratch, { recursive: true, mode: 0o700 });
    scratch = realpathSync(scratch);
    env.TMPDIR = scratch;
  }
  const [file, args] = windows ? ["cmd.exe", ["/d", "/s", "/c", command]]
    : boxed ? [SANDBOX_EXEC, ["-p", sandboxProfile(scratch!, existsSync(env.HOME!) ? realpathSync(env.HOME!) : env.HOME!), "/bin/sh", "-c", command]]
      : ["/bin/sh", ["-c", command]];
  return new Promise((resolve) => {
    let out = "", err = "", settled = false;
    const done = (result: ScriptResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const child = spawn(file, args, {
      cwd: options.cwd ?? scratch ?? env.HOME, env, stdio: ["ignore", "pipe", "pipe"], detached: !windows, windowsHide: true,
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
} as const;

export type ScriptGate = { refused: string } | { card: true } | { apply: true };

/** How this turn may give a routine a script check, which then runs a command with no AI: only on the owner's own
 * request; through the person's card (showing the command) at an ask-first level, or after the turn read anything from
 * outside unless the bot has Full access, since that text could have written the command. */
export function scriptCheckGate(
  turn: { owned: boolean; room: boolean; guest: boolean; depth: number; handedOff: boolean; outsideDriven: boolean; routineRun: boolean; personStarted: boolean; asksFirst: boolean },
  cloudHome: boolean,
  trust: { readOutside: boolean; fullAccess: boolean },
): ScriptGate {
  if (cloudHome) return { refused: SCRIPT_REFUSALS.cloud };
  if (!turn.owned || turn.room || turn.guest || turn.depth > 0 || turn.handedOff || turn.outsideDriven || turn.routineRun || !turn.personStarted) return { refused: SCRIPT_REFUSALS.notPerson };
  return turn.asksFirst || (trust.readOutside && !trust.fullAccess) ? { card: true } : { apply: true };
}

/** A routine, a change to one or a trigger request that sets a script check. */
export function setsScript(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as { probe?: { kind?: unknown } | null; routine?: unknown; changes?: unknown };
  return record.probe?.kind === "script" || setsScript(record.routine) || setsScript(record.changes);
}

/** Why a person's own request may not set this routine's script check: only this computer's owner, never on dusk cloud. */
export function scriptRoutineRefusal(body: unknown, cloudHome: boolean, owner: boolean): string | null {
  if (!setsScript(body)) return null;
  return cloudHome ? SCRIPT_REFUSALS.cloud : owner ? null : SCRIPT_REFUSALS.owner;
}
