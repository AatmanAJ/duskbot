import { afterEach, describe, expect, it, vi } from "vitest";

import type { StandaloneRelease } from "./contracts.ts";
import { OPENCODE_STANDALONE } from "./drivers/acp/opencode-release.ts";
import type { StandaloneInstalled } from "./engine-standalone.ts";
import { freeBackupArriving, PREINSTALL_FREE_BACKUP_ENV, preinstallFreeBackup, startFreeBackupPreinstall } from "./free-backup.ts";

const installed: StandaloneInstalled = { version: OPENCODE_STANDALONE.version, executablePath: "/data/tools/standalone/opencode/bin/opencode", binDir: "/data/tools/standalone/opencode/bin" };

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

describe("preinstalling OpenCode's free backup", () => {
  afterEach(() => vi.restoreAllMocks());

  it("downloads nothing when an OpenCode is already found", async () => {
    const install = vi.fn(async () => installed);
    await expect(preinstallFreeBackup({ present: () => true, install })).resolves.toEqual({ outcome: "present" });
    expect(install).not.toHaveBeenCalled();
  });

  it("installs the pinned build into the data folder through the standalone installer", async () => {
    const install = vi.fn(async () => installed);
    await expect(preinstallFreeBackup({ present: () => false, install, baseDir: "/data" })).resolves.toEqual({ outcome: "installed" });
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(OPENCODE_STANDALONE, { baseDir: "/data" });
  });

  it("shares one download between overlapping starts, and the next start finds the copy and downloads nothing", async () => {
    let copy = false;
    const download = gate();
    const install = vi.fn(async () => { await download.opened; copy = true; return installed; });
    const deps = { present: () => copy, install };
    const first = preinstallFreeBackup(deps);
    const second = preinstallFreeBackup(deps);
    download.open();
    await expect(Promise.all([first, second])).resolves.toEqual([{ outcome: "installed" }, { outcome: "installed" }]);
    await expect(preinstallFreeBackup(deps)).resolves.toEqual({ outcome: "present" });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("reports a failed download instead of throwing, and tries again next time", async () => {
    const install = vi.fn(async (): Promise<StandaloneInstalled> => { throw new Error("OpenCode couldn't be installed. Try again."); });
    await expect(preinstallFreeBackup({ present: () => false, install, retryMs: [] })).resolves.toEqual({ outcome: "failed", error: "OpenCode couldn't be installed. Try again." });
    await preinstallFreeBackup({ present: () => false, install, retryMs: [] });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("tries a download that stopped partway again, and installs once a try gets through", async () => {
    let tries = 0;
    const install = vi.fn(async (): Promise<StandaloneInstalled> => {
      tries += 1;
      if (tries < 3) throw new Error("The OpenCode download stopped partway. Check the internet connection and try again.");
      return installed;
    });
    const sleep = vi.fn(async () => {});
    await expect(preinstallFreeBackup({ present: () => false, install, retryMs: [1, 2], sleep })).resolves.toEqual({ outcome: "installed" });
    expect(install).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1], [2]]);
  });

  it("reports failed after its last try instead of waiting forever", async () => {
    const install = vi.fn(async (): Promise<StandaloneInstalled> => { throw new Error("stopped partway"); });
    await expect(preinstallFreeBackup({ present: () => false, install, retryMs: [1], sleep: async () => {} }))
      .resolves.toEqual({ outcome: "failed", error: "stopped partway" });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("never rejects, even when looking for an existing copy throws", async () => {
    const present = () => { throw new Error("PATH unreadable"); };
    await expect(preinstallFreeBackup({ present })).resolves.toEqual({ outcome: "failed", error: "PATH unreadable" });
  });

  it("skips a computer the release has no build for", async () => {
    const release: StandaloneRelease = { ...OPENCODE_STANDALONE, assets: {} };
    const install = vi.fn(async () => installed);
    await expect(preinstallFreeBackup({ present: () => false, install, release })).resolves.toEqual({ outcome: "unsupported" });
    expect(install).not.toHaveBeenCalled();
  });
});

describe("the preinstall at server start", () => {
  it("starts only when the server's starter asks for it", () => {
    const install = vi.fn(async () => installed);
    expect(startFreeBackupPreinstall({}, () => {}, { present: () => false, install })).toBeNull();
    expect(install).not.toHaveBeenCalled();
  });

  it("runs in the background: start returns before the download ends, and the engines are read again once it lands", async () => {
    const download = gate();
    const install = vi.fn(async () => { await download.opened; return installed; });
    const refreshed = vi.fn();
    const run = startFreeBackupPreinstall({ [PREINSTALL_FREE_BACKUP_ENV]: "1" }, refreshed, { present: () => false, install });
    expect(run).not.toBeNull();
    expect(refreshed).not.toHaveBeenCalled();
    download.open();
    await run;
    await Promise.resolve();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("a failing install or a throwing refresh never becomes an unhandled rejection that would end the server", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const install = vi.fn(async (): Promise<StandaloneInstalled> => { throw new Error("cut"); });
      await startFreeBackupPreinstall({ [PREINSTALL_FREE_BACKUP_ENV]: "1" }, () => {}, { present: () => false, install, retryMs: [] });
      await startFreeBackupPreinstall({ [PREINSTALL_FREE_BACKUP_ENV]: "1" }, () => { throw new Error("refresh broke"); }, { present: () => false, install: async () => installed });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("lets a first message wait for a download still under way, until the engines were read again, and never past its cap", async () => {
    expect(freeBackupArriving()).toBeNull();
    const download = gate();
    let refreshedAt = 0;
    const refreshed = async () => { await new Promise((resolve) => setTimeout(resolve, 5)); refreshedAt = Date.now(); };
    const run = startFreeBackupPreinstall({ [PREINSTALL_FREE_BACKUP_ENV]: "1" }, refreshed, { present: () => false, install: async () => { await download.opened; return installed; } });
    const arriving = freeBackupArriving();
    expect(arriving).not.toBeNull();
    const capped = await Promise.race([freeBackupArriving(20)!.then(() => "capped"), new Promise((resolve) => setTimeout(() => resolve("hung"), 500))]);
    expect(capped).toBe("capped");
    download.open();
    await arriving;
    expect(refreshedAt).toBeGreaterThan(0);
    await run;
    await Promise.resolve();
    expect(freeBackupArriving()).toBeNull();
  });

  it("reads the engines again only when a copy was added", async () => {
    const refreshed = vi.fn();
    await startFreeBackupPreinstall({ [PREINSTALL_FREE_BACKUP_ENV]: "1" }, refreshed, { present: () => true });
    await Promise.resolve();
    expect(refreshed).not.toHaveBeenCalled();
  });
});
