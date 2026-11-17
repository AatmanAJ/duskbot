// Whether the system's own Do Not Disturb is on, so the app's chime stays quiet with it. Only Linux desktops say so to
// any program: GNOME through its show-banners setting (off while Do Not Disturb is on, GNOME 3.34 and later) and KDE
// Plasma through the notification server's Inhibited property (Desktop Notifications spec 1.2 draft, Plasma 5.16 and
// later). macOS Focus and Windows Do Not Disturb have no public way to read them without a signed native module, so
// there the person's choice of the system sound (an OS banner that is not silent) is what follows them.
import { execFile as nodeExecFile } from "node:child_process";

const CACHE_MS = 15_000;
const PROBE_MS = 1_000;

const GNOME = ["gsettings", ["get", "org.gnome.desktop.notifications", "show-banners"]];
const FREEDESKTOP = ["gdbus", ["call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications",
  "--method", "org.freedesktop.DBus.Properties.Get", "org.freedesktop.Notifications", "Inhibited"]];

/**
 * @param {{ platform: NodeJS.Platform,
 *   execFile?: (file: string, args: string[], options: { timeout: number }, done: (error: Error | null, stdout: string) => void) => unknown,
 *   now?: () => number }} deps
 * @returns {() => Promise<boolean>} true while the system holds notifications back; false when it does not or cannot say.
 */
export function createSystemQuiet({ platform, execFile = nodeExecFile, now = Date.now }) {
  if (platform !== "linux") return async () => false;
  let cached = null;
  const ask = ([file, args]) => new Promise((resolve) => {
    try {
      execFile(file, args, { timeout: PROBE_MS }, (error, stdout) => resolve(error ? "" : String(stdout).trim()));
    } catch { resolve(""); }
  });
  const probe = async () => {
    const [banners, inhibited] = await Promise.all([ask(GNOME), ask(FREEDESKTOP)]);
    return banners === "false" || /^\(<true>,?\)$/.test(inhibited);
  };
  return () => {
    if (cached && now() - cached.at < CACHE_MS) return cached.quiet;
    const quiet = probe().catch(() => false);
    cached = { at: now(), quiet };
    return quiet;
  };
}
