// Moving the window from this computer's page to another origin shows a blank frame until the new page paints (Chromium
// holds paint only within one site). A still picture of the page being left covers the window until the next page has
// drawn its app, so the person never sees a blank window.

/** How long the picture may stay up: a page that hasn't drawn by then is not coming soon. */
export const PAINT_HOLD_MS = 20_000;
const LOOK_EVERY_MS = 100;

/** The script a page answers once it has drawn its app (anything in #root) and painted that frame. */
export const PAINTED_SCRIPT = `new Promise((done) => {
  const root = document.getElementById("root");
  if (!root || !root.firstElementChild) return done(false);
  requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
})`;

/**
 * Runs `load` under a cover: `cover()` puts the picture up (and answers how to take it down, or null when it can't),
 * `painted()` asks whether the new page has drawn. Answers true once it has, false when the load failed or nothing was
 * drawn within `timeoutMs`; the cover is down either way.
 * @param {{ cover(): Promise<(() => void) | null>, load(): Promise<unknown>, painted(): Promise<boolean>, timeoutMs?: number,
 *   wait?(ms: number): Promise<void>, now?(): number }} deps
 */
export async function holdUntilPainted({ cover, load, painted, timeoutMs = PAINT_HOLD_MS, wait = (ms) => new Promise((done) => setTimeout(done, ms)), now = Date.now }) {
  let deadline = null;
  const late = new Promise((done) => { deadline = setTimeout(() => done(false), timeoutMs); deadline.unref?.(); });
  const started = now();
  let uncover = null;
  try { uncover = await cover(); } catch { uncover = null; }
  try {
    const loaded = await Promise.race([Promise.resolve(load()).then((ok) => ok !== false, () => false), late]);
    if (!loaded) return false;
    while (now() - started < timeoutMs) {
      if (await painted().catch(() => false)) return true;
      await wait(LOOK_EVERY_MS);
    }
    return false;
  } finally {
    clearTimeout(deadline);
    try { uncover?.(); } catch {}
  }
}
