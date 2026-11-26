// A dusk cloud's image ships Codex in a folder owned by the machine user, not the one the server runs as, so
// `codex update` cannot replace it; the newest stable release goes into the server's own engine folder instead.
import type { ProviderRegistry } from "./harness/registry.ts";
import { installNpmEngine } from "./engine-install.ts";
import { augmentedPath } from "./env-path.ts";
import { execCli } from "./procs.ts";
import { codexVersionBehind, readLatestCodexRelease } from "./drivers/codex-release.ts";

export const CODEX_PACKAGE = "@openai/codex";
/** The oldest Codex a cloud keeps: ChatGPT's newer models (gpt-6.2-sol) need 0.166. Below it the update runs even when
 * the release lookup fails. */
export const CODEX_MIN_VERSION = "0.166.0";

const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;
const BUSY_RETRY_MS = 2 * 60_000;
const FAILED_RETRY_MS = 60 * 60_000;

export interface CodexUpkeepDeps {
  /** What `codex --version` says for the copy the engine runs, null when none starts. */
  installedVersion(): Promise<string | null>;
  /** The newest stable release, null when the lookup fails. */
  latestRelease(): Promise<string | null>;
  turnsRunning(): number;
  install(): Promise<void>;
  /** After an update: the engines read their CLI again. */
  updated(): Promise<void>;
  log(line: string): void;
}

export type CodexUpkeepResult =
  | { result: "current"; version: string }
  | { result: "busy" }
  | { result: "updated"; from: string | null; to: string }
  | { result: "failed"; from: string | null };

export function codexNeedsUpdate(installed: string | null, latest: string | null): boolean {
  if (!installed) return true;
  if (codexVersionBehind(installed, CODEX_MIN_VERSION)) return true;
  return latest !== null && codexVersionBehind(installed, latest);
}

export async function codexUpkeepOnce(deps: CodexUpkeepDeps): Promise<CodexUpkeepResult> {
  const [installed, latest] = await Promise.all([deps.installedVersion(), deps.latestRelease()]);
  if (!codexNeedsUpdate(installed, latest)) return { result: "current", version: installed! };
  // npm replaces the package in place; a turn starting meanwhile could find it half written.
  if (deps.turnsRunning() > 0) return { result: "busy" };
  try {
    await deps.install();
  } catch (error) {
    deps.log(`codex upkeep: the update from ${installed ?? "none"} failed: ${error instanceof Error ? error.message : String(error)}`);
    return { result: "failed", from: installed };
  }
  const now = await deps.installedVersion();
  if (!now || codexNeedsUpdate(now, null)) {
    deps.log(`codex upkeep: npm finished, but codex reports ${now ?? "nothing"} (was ${installed ?? "none"})`);
    return { result: "failed", from: installed };
  }
  deps.log(`codex upkeep: updated ${installed ?? "none"} -> ${now}`);
  await deps.updated().catch((error: unknown) => deps.log(`codex upkeep: engines could not be read again: ${error instanceof Error ? error.message : String(error)}`));
  return { result: "updated", from: installed, to: now };
}

export function startCodexUpkeep(deps: CodexUpkeepDeps, timing = { first: FIRST_CHECK_MS, every: CHECK_EVERY_MS, busy: BUSY_RETRY_MS, failed: FAILED_RETRY_MS }): { stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), ms);
    timer.unref?.();
  };
  const tick = async () => {
    let next = timing.every;
    try {
      const outcome = await codexUpkeepOnce(deps);
      if (outcome.result === "busy") next = timing.busy;
      else if (outcome.result === "failed") next = timing.failed;
    } catch (error) {
      deps.log(`codex upkeep: check failed: ${error instanceof Error ? error.message : String(error)}`);
      next = timing.failed;
    }
    schedule(next);
  };
  schedule(timing.first);
  return { stop: () => { stopped = true; if (timer) clearTimeout(timer); } };
}

/** On by default on a dusk cloud; DUSK_CODEX_AUTO_UPDATE=0 turns it off, =1 turns it on for another server. */
export function codexAutoUpdateEnabled(cloudHome: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.DUSK_CODEX_AUTO_UPDATE;
  return flag === "1" || (cloudHome && flag !== "0");
}

/** POSIX looks `codex` up on the spawn's own PATH, so it is the one the engines spawn with: the app's folder first. */
export function readCodexVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execCli("codex", ["--version"], { env: { ...process.env, PATH: augmentedPath() }, timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 }, (error, stdout) => {
      const version = error ? "" : String(stdout).trim().split("\n")[0]!.trim();
      resolve(version || null);
    });
  });
}

export function codexUpkeepFor(registry: Pick<ProviderRegistry, "entries" | "forgetSnapshots" | "readEngine">, turnsRunning: () => number, log: (line: string) => void): CodexUpkeepDeps {
  return {
    installedVersion: readCodexVersion,
    latestRelease: readLatestCodexRelease,
    turnsRunning,
    install: () => installNpmEngine(CODEX_PACKAGE, { cli: "codex" }),
    updated: async () => {
      registry.forgetSnapshots();
      const codex = registry.entries().filter((entry) => entry.live?.driverKind === "codex");
      await Promise.all(codex.map((entry) => registry.readEngine(entry.instanceId, true)));
    },
    log,
  };
}
