// A switch between places covers the window's page with the loading mascot from the click on: the page being left
// shows it at once, and keeps it until the next page replaces it (that page's own boot cover then waits for its chats),
// or takes it away when the switch ends without a new page. The mascot the page being left drew is handed to the next
// page, which goes on with it where it was rather than starting over with another.

/** A handed mascot older than this belongs to no switch any more. */
export const HANDED_LOOK_MS = 20_000;
const WORD = /^[a-z]{1,16}$/;
const PAINT = /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%/]{1,40}\))$/i;

/** A mascot as a page hands it on: its crew member, colour and mood, how long it has been on screen, and the ink it is
 * drawn in and the ground under it, so the next page can paint it before its own code has loaded. */
export function handedLook(value) {
  if (!value || typeof value !== "object") return null;
  const { crew, color, mood, elapsed, ink, ground } = value;
  if (![crew, color, mood].every((word) => typeof word === "string" && WORD.test(word))) return null;
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < 0) return null;
  const paint = (one) => typeof one === "string" && PAINT.test(one.trim());
  return { crew, color, mood, elapsed: Math.min(elapsed, HANDED_LOOK_MS), ...(paint(ink) && paint(ground) ? { ink: ink.trim(), ground: ground.trim() } : {}) };
}

/**
 * @param {{ window: () => (import("electron").BrowserWindow | null), now?: () => number, log?: (line: string) => void }} deps
 */
export function createWorkspaceSwitch({ window, now = Date.now, log = () => {} }) {
  let depth = 0, navigated = false, watched = null, handed = null;
  const onNavigation = (details) => { if (details?.isMainFrame !== false && details?.isSameDocument !== true) navigated = true; };
  const tell = (win, on) => {
    try { win.webContents.send("workspaces:switching", on); } catch (error) { log(`switch: could not tell the page (${error?.message ?? error})`); }
  };
  const live = () => { const win = window(); return win && !win.isDestroyed() ? win : null; };

  return {
    /** Runs one switch (`action`) under the cover; a switch inside another is part of it. Answers what `action` answered. */
    async around(action) {
      const win = depth === 0 ? live() : null;
      if (depth === 0) {
        navigated = false;
        watched = win?.webContents ?? null;
        watched?.on("did-start-navigation", onNavigation);
        if (win) tell(win, true);
      }
      depth += 1;
      try { return await action(); } finally {
        depth -= 1;
        if (depth === 0) {
          watched?.removeListener("did-start-navigation", onNavigation);
          const same = live();
          // a page that replaced the one being left shows its own boot cover; only the page still there is told it is over
          if (!navigated) handed = null;
          if (same && same.webContents === watched && !navigated) tell(same, false);
          watched = null;
        }
      }
    },
    /** The page being left hands on its mascot. */
    hand(value) {
      const look = handedLook(value);
      handed = look ? { look, at: now() } : null;
    },
    /** The next page takes the mascot handed on, once, while it is fresh; null when there is none. */
    take() {
      const was = handed;
      handed = null;
      if (!was) return null;
      const age = now() - was.at;
      if (age < 0 || age > HANDED_LOOK_MS) return null;
      return { ...was.look, elapsed: Math.min(HANDED_LOOK_MS, was.look.elapsed + age) };
    },
  };
}

/** Only the window's own page hands a mascot on or takes one. */
export function installWorkspaceSwitchIpc({ ipcMain, workspaceSwitch, window }) {
  const ours = (event) => { const win = window(); return Boolean(win && !win.isDestroyed() && event?.sender === win.webContents); };
  ipcMain.on("workspaces:switch-look", (event, value) => { if (ours(event)) workspaceSwitch.hand(value); });
  ipcMain.on("workspaces:switch-look-take", (event) => { event.returnValue = ours(event) ? workspaceSwitch.take() : null; });
}
