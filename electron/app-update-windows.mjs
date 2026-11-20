// windows installs its own updates with the release's NSIS installer (electron-builder oneClick, per user, so no UAC
// prompt). the updater downloads it and checks its sha256 against the signed manifest's SHA256SUMS; when the app quits,
// after its own shutdown, the installer runs silently: /S, --updated (keeps data and the person's shortcuts, closes what
// is left of the app) and, for "restart to update", --force-run (starts the new version).
// SmartScreen: Windows checks a file's reputation when it is opened through the shell and carries the Mark of the Web
// (a Zone.Identifier stream, which browsers write). this file is written by the app itself, any mark is removed, and it
// is started with CreateProcess (child_process.spawn), so no SmartScreen prompt shows. Smart App Control (Windows 11)
// can still refuse an unsigned installer; the next launch then sees the version did not change (`failed`).
import { spawn as spawnProcess } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { newer } from "./app-update.mjs";

export const TRIED = "installing.json";

/** the installer's arguments: silent, as an update, and starting the app after it when `relaunch` */
export const setupArgs = (relaunch) => ["/S", "--updated", ...(relaunch ? ["--force-run"] : [])];

const writableDir = (dir) => { try { accessSync(dir, constants.W_OK); return true; } catch { return false; } };

/**
 * whether the installer can update the app at `exe`: "portable" for the zip build (no NSIS uninstaller beside it; the
 * installer would add a second copy elsewhere), "readonly" when its folder can't be written, else null
 */
export function windowsPlace(exe, { list = readdirSync, writable = writableDir } = {}) {
  const dir = dirname(exe);
  let names = [];
  try { names = list(dir); } catch { return "portable"; }
  if (!names.some((name) => /^Uninstall .+\.exe$/i.test(name))) return "portable";
  return writable(dir) ? null : "readonly";
}

/**
 * `prepare(file, version)` keeps the verified installer for the quit; `install()` quits to run it and start the new
 * version; `quitting({ ending })` (from will-quit) runs it, without starting the app, also on a plain quit, but never while
 * Windows ends the session (it could be killed half way). `failed(version)`: that version's installer ran and this app is
 * still older.
 */
export function nsisInstaller({ dir, current, quit, spawn = spawnProcess, log = () => {} }) {
  const tried = join(dir, TRIED);
  let file = null, version = null, relaunch = false, ran = false;
  return {
    async prepare(path, next) {
      // a file this app wrote has no Mark of the Web; one added by anything else would bring SmartScreen back
      try { unlinkSync(`${path}:Zone.Identifier`); } catch { /* none */ }
      file = path;
      version = next;
    },
    install() {
      relaunch = true;
      quit();
    },
    quitting({ ending = false } = {}) {
      if (!file || ran || (ending && !relaunch)) return false;
      ran = true;
      try { writeFileSync(tried, JSON.stringify({ version })); } catch { /* failed() can't tell then */ }
      try {
        const child = spawn(file, setupArgs(relaunch), { detached: true, stdio: "ignore", windowsHide: true });
        child.on?.("error", (error) => log(`app update: the installer did not start (${error?.code ?? error?.message ?? error})`));
        child.unref?.();
        log(`app update: installing ${version}${relaunch ? " and restarting" : ""}`);
        return true;
      } catch (error) {
        log(`app update: the installer did not start (${error?.code ?? error?.message ?? error})`);
        return false;
      }
    },
    failed(next) {
      try {
        const before = JSON.parse(readFileSync(tried, "utf8"))?.version;
        return before === next && newer(next, current);
      } catch {
        return false;
      }
    },
  };
}
