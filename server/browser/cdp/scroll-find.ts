// Scrolling as a person looks for something: wheel the list or page, let it load and draw, and stop once the text
// shows; virtual lists and infinite feeds only put rows in the page near where they are scrolled to.
import { scroll, type ActionContext, type Target } from "./actions.ts";
import { valueInWorld } from "./evaluate.ts";
import type { Point } from "./input.ts";

export const MAX_SCROLLS = 30;
const SETTLE_MS = 350;
const POLL_MS = 70;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The deepest shown element whose text holds `wanted` (any case), brought to the middle of its scrolling box; false when none. */
const REVEAL = (wanted: string) => `(() => {
  const want = ${JSON.stringify(wanted.toLowerCase().replace(/\s+/gu, " ").trim())};
  const has = (el) => (el.innerText || "").toLowerCase().replace(/\\s+/g, " ").includes(want);
  if (!document.body || !has(document.body)) return false;
  let at = document.body;
  for (let deeper = true; deeper;) {
    deeper = false;
    for (const child of at.children) if (has(child)) { at = child; deeper = true; break; }
  }
  at.scrollIntoView({ block: "center", inline: "nearest" });
  return true;
})()`;

/** What moves when a scroll lands: the page's offset, the scroll offsets of the boxes under the wheel, the text's length. */
const POSITION = (point: Point) => `(() => {
  let sum = 0;
  for (let el = document.elementFromPoint(${point.x}, ${point.y}); el; el = el.parentElement) sum += el.scrollTop;
  return Math.round(scrollY) + ":" + Math.round(sum) + ":" + (document.body ? document.body.innerText.length : 0);
})()`;

export interface ScrollFound { found: boolean; scrolls: number; atEnd: boolean }

/** Scrolls by dx, dy at a time until `text` shows, the box stops moving, or MAX_SCROLLS. */
export async function scrollUntil(context: ActionContext, target: Target | null, dx: number, dy: number, text: string, deadline: number): Promise<ScrollFound> {
  const main = context.frames.mainFrameId;
  const reveal = () => valueInWorld<boolean>(context.frames, main, REVEAL(text)).catch(() => false);
  if (await reveal()) return { found: true, scrolls: 0, atEnd: false };
  let still = 0;
  let previous = "";
  for (let scrolls = 1; scrolls <= MAX_SCROLLS && Date.now() < deadline; scrolls++) {
    const point = await scroll(context, target, dx, dy, { timeoutMs: Math.max(1_000, deadline - Date.now()) });
    const position = () => valueInWorld<string>(context.frames, main, POSITION(point)).catch(() => "");
    let last = await position();
    // a feed fetches its next rows, a virtual list draws the ones scrolled to
    for (let since = Date.now(), started = since; Date.now() - started < 1_500;) {
      await sleep(POLL_MS);
      const now = await position();
      if (now !== last) { last = now; since = Date.now(); } else if (Date.now() - since >= SETTLE_MS) break;
    }
    if (await reveal()) return { found: true, scrolls, atEnd: false };
    const signature = await position();
    still = signature === previous ? still + 1 : 0;
    previous = signature;
    if (still >= 2) return { found: false, scrolls, atEnd: true };
  }
  return { found: false, scrolls: MAX_SCROLLS, atEnd: false };
}
