import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODEX_MIN_VERSION, codexAutoUpdateEnabled, codexNeedsUpdate, codexUpkeepOnce, readCodexVersion, startCodexUpkeep, type CodexUpkeepDeps } from "./codex-upkeep.ts";
import { registerPathDir, resetPathCacheForTests } from "./env-path.ts";
import { removeTempDir } from "./testing/cleanup.ts";

function deps(over: Partial<CodexUpkeepDeps> & { versions?: Array<string | null> } = {}) {
  const versions = over.versions ?? ["codex-cli 0.160.0", "codex-cli 0.167.0"];
  let read = 0;
  const lines: string[] = [];
  const d: CodexUpkeepDeps & { lines: string[]; installs: number; refreshes: number } = {
    lines, installs: 0, refreshes: 0,
    installedVersion: async () => versions[Math.min(read++, versions.length - 1)] ?? null,
    latestRelease: async () => "0.167.0",
    turnsRunning: () => 0,
    install: async () => { d.installs++; },
    updated: async () => { d.refreshes++; },
    log: (line) => lines.push(line),
    ...over,
  };
  return d;
}

describe("codex upkeep", () => {
  afterEach(() => vi.useRealTimers());

  it("wants an update below the pinned minimum, behind the latest stable, or with no copy at all", () => {
    expect(CODEX_MIN_VERSION).toBe("0.166.0");
    expect(codexNeedsUpdate("codex-cli 0.160.0", null)).toBe(true);
    expect(codexNeedsUpdate("codex-cli 0.166.0", null)).toBe(false);
    expect(codexNeedsUpdate("codex-cli 0.166.0", "0.167.0")).toBe(true);
    expect(codexNeedsUpdate("codex-cli 0.168.0", "0.167.0")).toBe(false);
    expect(codexNeedsUpdate(null, "0.167.0")).toBe(true);
  });

  it("updates an old image copy, then has the engines read the CLI again", async () => {
    const d = deps();
    await expect(codexUpkeepOnce(d)).resolves.toEqual({ result: "updated", from: "codex-cli 0.160.0", to: "codex-cli 0.167.0" });
    expect(d.installs).toBe(1);
    expect(d.refreshes).toBe(1);
    expect(d.lines).toEqual(["codex upkeep: updated codex-cli 0.160.0 -> codex-cli 0.167.0"]);
  });

  it("still lifts a copy below the minimum when the release lookup fails", async () => {
    const d = deps({ latestRelease: async () => null });
    await expect(codexUpkeepOnce(d)).resolves.toMatchObject({ result: "updated" });
  });

  it("leaves a current copy alone", async () => {
    const d = deps({ versions: ["codex-cli 0.167.0"] });
    await expect(codexUpkeepOnce(d)).resolves.toEqual({ result: "current", version: "codex-cli 0.167.0" });
    expect(d.installs).toBe(0);
  });

  it("never installs while a turn is running", async () => {
    const d = deps({ turnsRunning: () => 1 });
    await expect(codexUpkeepOnce(d)).resolves.toEqual({ result: "busy" });
    expect(d.installs).toBe(0);
  });

  it("logs a failed npm run and an install that still reports an old version, and refreshes nothing", async () => {
    const failing = deps({ install: async () => { throw new Error("npm could not install @openai/codex on this server."); } });
    await expect(codexUpkeepOnce(failing)).resolves.toEqual({ result: "failed", from: "codex-cli 0.160.0" });
    expect(failing.lines[0]).toContain("npm could not install");
    const stale = deps({ versions: ["codex-cli 0.160.0", "codex-cli 0.160.0"] });
    await expect(codexUpkeepOnce(stale)).resolves.toMatchObject({ result: "failed" });
    expect(stale.refreshes).toBe(0);
  });

  it("checks after start, retries a busy server soon and a failed one later", async () => {
    vi.useFakeTimers();
    let busy = true;
    const d = deps({ turnsRunning: () => (busy ? 1 : 0), versions: ["codex-cli 0.160.0", "codex-cli 0.160.0", "codex-cli 0.167.0"] });
    const upkeep = startCodexUpkeep(d, { first: 1000, every: 100_000, busy: 2000, failed: 50_000 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.installs).toBe(0);
    busy = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(d.installs).toBe(1);
    expect(d.refreshes).toBe(1);
    upkeep.stop();
  });

  it.skipIf(process.platform === "win32")("reads the copy in the app's engine folder, not the first on the server's own PATH", async () => {
    const root = mkdtempSync(join(tmpdir(), "codex-upkeep-"));
    try {
      const fake = (dir: string, version: string) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "codex"), `#!/bin/sh\necho "codex-cli ${version}"\n`, { mode: 0o755 });
      };
      fake(join(root, "image"), "0.160.0");
      fake(join(root, "app"), "0.172.0");
      vi.stubEnv("PATH", `${join(root, "image")}:/usr/bin:/bin`);
      resetPathCacheForTests();
      await expect(readCodexVersion()).resolves.toBe("codex-cli 0.160.0");
      registerPathDir(join(root, "app"));
      await expect(readCodexVersion()).resolves.toBe("codex-cli 0.172.0");
    } finally {
      vi.unstubAllEnvs();
      resetPathCacheForTests();
      await removeTempDir(root);
    }
  });

  it("is on for a cloud unless switched off, and off elsewhere unless switched on", () => {
    expect(codexAutoUpdateEnabled(true, {})).toBe(true);
    expect(codexAutoUpdateEnabled(true, { DUSK_CODEX_AUTO_UPDATE: "0" })).toBe(false);
    expect(codexAutoUpdateEnabled(false, {})).toBe(false);
    expect(codexAutoUpdateEnabled(false, { DUSK_CODEX_AUTO_UPDATE: "1" })).toBe(true);
  });
});
