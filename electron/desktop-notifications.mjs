// A bot's notification on the desktop app, shown by main. A page's own `new Notification` dies with the page: Electron 43
// hands its click to the page that made it, so a banner clicked after a reload, an update or a move to another place does
// nothing, and `window.focus()` from a page never raises a window (shell/browser/api/electron_api_browser_window.cc,
// OnActivateContents). Main knows which page asked, so the click comes back to that place whatever is on screen by then.
// An ask's banner (an approval, a question) closes once the page sees that bot stop waiting on the person, wherever it
// was answered: the phone, the island or another window.

const ID = /^[\w-]{1,128}$/;
const TEXT_LIMIT = 1024;
/** A click waits this long for its place to open (a Cloud may have to wake), and no longer: opening that place hours later
 * must not jump to an old banner's thread. */
const PLACE_WAIT_MS = 2 * 60_000;
const ICON_WAIT_MS = 1_500;

const text = (value) => (typeof value === "string" ? value.slice(0, TEXT_LIMIT) : "");
const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

const MAX_BOTS = 200;
const ids = (value) => new Set(Array.isArray(value) ? value.slice(0, MAX_BOTS).filter((entry) => typeof entry === "string" && ID.test(entry)) : []);

/**
 * @param {{ ipcMain: { handle(channel: string, handler: (event: any, note: any) => unknown): void,
 *   on(channel: string, handler: (event: any, report: any) => void): void },
 *   Notification: { new(options: object): any, isSupported(): boolean },
 *   nativeImage: { createFromBuffer(buffer: Buffer): { isEmpty(): boolean } },
 *   fetch: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean, arrayBuffer(): Promise<ArrayBuffer> }>,
 *   window: () => any,
 *   mayNotify: (contents: unknown, url: string) => boolean,
 *   reveal: () => void,
 *   openPlace: (origin: string) => unknown,
 *   systemQuiet?: () => Promise<boolean>,
 *   now?: () => number }} deps
 * `window`: the main window, if any. `mayNotify`: the same rule that lets its page use `new Notification`. `reveal`: raises
 * the window. `openPlace`: main's own switch to the place at an origin. `systemQuiet`: whether the system's Do Not Disturb
 * is on (system-quiet.mjs).
 */
export function installDesktopNotifications({ ipcMain, Notification, nativeImage, fetch, window, mayNotify, reveal, openPlace, systemQuiet = async () => false, now = Date.now }) {
  // Electron drops a notification's handlers once nothing holds it, so each is held until it is replaced or dismissed.
  const live = new Map();
  /** Per origin, the bots its page last said wait on the person. */
  const waitingAt = new Map();
  let waiting = null;

  const page = () => { const win = window(); return win && !win.isDestroyed() ? win.webContents : null; };
  /** The origin of the page on screen, null while one is loading. */
  const shownOrigin = () => { const contents = page(); return contents && !contents.isLoadingMainFrame() ? originOf(contents.getURL()) : null; };
  /** The window's own page may ask, in its main frame: never the rail, a viewer or a frame inside a page. */
  const askingOrigin = (event) => {
    const contents = page(), frame = event.senderFrame;
    return contents && event.sender === contents && frame === contents.mainFrame && mayNotify(contents, frame.url) ? originOf(frame.url) : null;
  };
  const open = (target) => page()?.send("desktop-notifications:open", target);

  const bring = (origin, target) => {
    reveal();
    const shown = shownOrigin();
    if (shown === origin) { waiting = null; open(target); return; }
    waiting = { origin, target, at: now(), asked: shown !== null };
    if (waiting.asked) void openPlace(origin);
  };

  const pictureOf = async (origin, raw) => {
    if (typeof raw !== "string" || !raw) return null;
    try {
      const url = new URL(raw, origin);
      if (url.origin !== origin) return null;
      const answer = await fetch(url.href, { signal: AbortSignal.timeout(ICON_WAIT_MS) });
      if (!answer.ok) return null;
      const image = nativeImage.createFromBuffer(Buffer.from(await answer.arrayBuffer()));
      return image.isEmpty() ? null : image;
    } catch { return null; }
  };

  ipcMain.handle("desktop-notifications:show", async (event, note) => {
    const origin = askingOrigin(event);
    if (!origin || !Notification.isSupported() || !note || typeof note !== "object") return false;
    const { title, body, tag, silent, chime, picture, botId, threadId, ask } = note;
    if (!text(title) || !ID.test(String(botId)) || !ID.test(String(threadId))) return false;
    const key = `${origin}\n${text(tag) || threadId}`;
    const image = await pictureOf(origin, picture);
    const shown = new Notification({ title: text(title), body: text(body), silent: silent === true, ...(image ? { icon: image } : {}) });
    // `seen`: the page has said this bot waits, so its saying the bot no longer does means the ask was answered
    const entry = { shown, origin, botId, ask: ask === true, seen: waitingAt.get(origin)?.has(botId) === true };
    const replaced = live.get(key)?.shown;
    live.set(key, entry);
    replaced?.close();
    shown.on("close", () => { if (live.get(key) === entry) live.delete(key); });
    shown.on("click", () => { if (live.get(key) === entry) live.delete(key); bring(origin, { botId, threadId }); });
    shown.show();
    return chime === true && await systemQuiet().catch(() => false) ? "hushed" : true;
  });

  // `waiting`: the bots this page shows waiting on the person; `settled`: the ones it has loaded that do not. A bot in
  // neither (not loaded yet) keeps its banner.
  ipcMain.on("desktop-notifications:asks", (event, report) => {
    const origin = askingOrigin(event);
    if (!origin || !report || typeof report !== "object") return;
    const waits = ids(report.waiting), settled = ids(report.settled);
    waitingAt.set(origin, waits);
    for (const [key, entry] of live) {
      if (!entry.ask || entry.origin !== origin) continue;
      if (waits.has(entry.botId)) entry.seen = true;
      else if (entry.seen && settled.has(entry.botId)) { live.delete(key); entry.shown.close(); }
    }
  });

  return {
    /** A bot's chat opened from elsewhere in the app (the island, the dock), in the place `origin` it lives in. */
    openAt(origin, target) {
      if (typeof origin !== "string" || !ID.test(String(target?.botId)) || !ID.test(String(target?.threadId))) return false;
      bring(origin, { botId: target.botId, threadId: target.threadId });
      return true;
    },
    /** The window finished loading a page: a click that was waiting for this place lands now. */
    arrived() {
      if (!waiting) return;
      if (now() - waiting.at > PLACE_WAIT_MS) { waiting = null; return; }
      if (shownOrigin() !== waiting.origin) {
        if (!waiting.asked) { waiting.asked = true; void openPlace(waiting.origin); }
        return;
      }
      const { target } = waiting;
      waiting = null;
      open(target);
    },
  };
}
