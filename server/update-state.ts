// What this install knows about its own updates, kept in <data>/update-state.json: the versions it booted, the last
// self-test (server/update-selftest.ts), the one-line digest the app shows ("Updated to 1.4.2" / "Update rolled back,
// nothing lost") and the runs a bad version failed, which run again once for free. A boot on a newer version self-tests
// and, once that passes, says "Updated"; a boot on an older version than the last one was a rollback. The managed cloud
// reads `report()` through its signed route; the VPS installer reads the file itself.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions } from "../shared/update-guard.ts";
import { writeFileAtomic } from "./atomic.ts";
import { runSelfTest, type SelfTestChecks, type SelfTestResult } from "./update-selftest.ts";

export const UPDATE_STATE_FILE = "update-state.json";
export interface UpdateDigest { kind: "updated" | "rolled_back"; version: string; at: number }
/** `infra`: it failed because its bot computer could not be reached (docker or its gate), not for anything the version did */
export interface FinishedRun { id: string; ok: boolean; at: number; infra?: true }
export interface UpdateReport { v: 1; version: string; bootedAt: number; selfTest: "running" | "passed" | "failed" | null; runs: FinishedRun[] }
interface Stored {
  v: 1;
  boots: Array<{ version: string; at: number }>;
  selfTest: (SelfTestResult & { version: string }) | null;
  digest: (UpdateDigest & { seen: boolean }) | null;
  freeReruns: string[];
}

const empty = (): Stored => ({ v: 1, boots: [], selfTest: null, digest: null, freeReruns: [] });

export function readUpdateState(dataDir: string): Stored {
  try {
    const value = JSON.parse(readFileSync(join(dataDir, UPDATE_STATE_FILE), "utf8")) as Partial<Stored>;
    if (value?.v !== 1 || !Array.isArray(value.boots)) return empty();
    return { v: 1, boots: value.boots.filter(b => typeof b?.version === "string" && Number.isFinite(b.at)).slice(-10), selfTest: value.selfTest ?? null,
      digest: value.digest ?? null, freeReruns: Array.isArray(value.freeReruns) ? value.freeReruns.filter(id => typeof id === "string").slice(-50) : [] };
  } catch { return empty(); }
}

export function createUpdateState(options: { dataDir: string; version: string; checks: SelfTestChecks; runs(since: number): FinishedRun[]; now?: () => number; log?: (line: string) => void }) {
  const now = options.now ?? Date.now, log = options.log ?? (() => {});
  let state = readUpdateState(options.dataDir), bootedAt = now(), testing: Promise<SelfTestResult> | null = null;
  const save = () => writeFileAtomic(join(options.dataDir, UPDATE_STATE_FILE), JSON.stringify(state), { mode: 0o600 });

  function selfTest(): Promise<SelfTestResult> {
    testing ??= (async () => {
      const before = state.selfTest;
      const result = await runSelfTest(options.checks, before, { now });
      state.selfTest = { ...result, version: options.version };
      const last = state.boots.at(-2);
      if (result.ok && last && compareVersions(options.version, last.version) > 0 && state.digest?.version !== options.version) {
        state.digest = { kind: "updated", version: options.version, at: now(), seen: false };
      }
      save();
      log(`update: self-test on ${options.version} ${result.ok ? "passed" : "failed"} (${Object.entries(result.checks).map(([k, v]) => `${k} ${v}`).join(", ")})`);
      return result;
    })().finally(() => { testing = null; });
    return testing;
  }

  return {
    /** at start: records this boot; self-tests when the version changed (or was never tested); a step down is a rollback */
    boot(): Promise<SelfTestResult> | null {
      state = readUpdateState(options.dataDir);
      bootedAt = now();
      const last = state.boots.at(-1);
      state.boots = [...state.boots, { version: options.version, at: bootedAt }].slice(-10);
      if (last && compareVersions(options.version, last.version) < 0) {
        // the bad version's failed runs since it started: each runs again once, not charged (the routines take them)
        const failed = options.runs(last.at).filter(r => !r.ok).map(r => r.id);
        state.freeReruns = [...new Set([...state.freeReruns, ...failed])].slice(-50);
        state.digest = { kind: "rolled_back", version: last.version, at: bootedAt, seen: false };
        log(`update: rolled back from ${last.version} to ${options.version}; ${failed.length} failed run(s) run again free`);
      }
      save();
      return !last || last.version !== options.version || state.selfTest?.version !== options.version ? selfTest() : null;
    },
    selfTest,
    report(): UpdateReport {
      const tested = state.selfTest?.version === options.version ? state.selfTest : null;
      return { v: 1, version: options.version, bootedAt, selfTest: testing ? "running" : tested ? (tested.ok ? "passed" : "failed") : null, runs: options.runs(bootedAt).slice(-20) };
    },
    /** the digest line the app has not shown yet */
    digest(): UpdateDigest | null {
      const d = state.digest;
      return d && !d.seen ? { kind: d.kind, version: d.version, at: d.at } : null;
    },
    seen(): void { if (state.digest && !state.digest.seen) { state.digest.seen = true; save(); } },
    /** the runs a rolled-back version failed, handed out once (to the routines, which re-run them without charge) */
    takeFreeReruns(): string[] {
      const ids = state.freeReruns;
      if (ids.length) { state.freeReruns = []; save(); }
      return ids;
    },
  };
}
export type UpdateState = ReturnType<typeof createUpdateState>;
