// What sits over an element a click is aimed at, and how to get past it as a person would: click a part of the
// element that shows, scroll it out from under a fixed bar, or say how to close what stays on top.

/** A hit on the element, inside it, or on a label that forwards its clicks to it counts as the element's. */
export const RECEIVES = `function (hit, wantEnabled) {
  const disabled = wantEnabled && (this.disabled === true || this.closest?.("fieldset[disabled]") != null || this.getAttribute?.("aria-disabled") === "true");
  if (disabled) return { disabled: true, covering: null };
  if (!hit) return { disabled: false, covering: null };
  const within = (node) => { for (let at = node; at; at = at.parentNode || at.host) if (at === this) return true; return false; };
  if (within(hit)) return { disabled: false, covering: null };
  const element = hit.nodeType === 1 ? hit : hit.parentElement;
  if (!element) return { disabled: false, covering: "another element", fixed: null };
  const label = element.closest && element.closest("label");
  if (label && (label.control === this || (this.labels && [...this.labels].includes(label)) || label.contains(this))) return { disabled: false, covering: null };
  const describe = (el) => {
    const id = el.id ? "#" + el.id : "";
    const classes = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
    const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
    return "<" + el.tagName.toLowerCase() + id + classes + ">" + (text ? ' "' + text + '"' : "");
  };
  let fixed = null;
  for (let at = element; at && at.nodeType === 1; at = at.parentElement || (at.getRootNode && at.getRootNode().host)) {
    const position = getComputedStyle(at).position;
    if (position === "fixed" || position === "sticky") { fixed = at; break; }
  }
  if (!fixed) return { disabled: false, covering: describe(element), fixed: null };
  const box = fixed.getBoundingClientRect();
  const busy = /^\\s*(?:loading|please wait|processing|saving)/i.test(fixed.innerText || "") || fixed.matches('[aria-busy="true"],[role="progressbar"],[class*="spinner" i],[class*="loading" i]') || !!fixed.querySelector('[aria-busy="true"],[role="progressbar"],[class*="spinner" i]');
  const closer = [...fixed.querySelectorAll('button,[role="button"],a')].find((el) => /close|dismiss|hide|got it|no thanks|not now|^\\s*[×✕✖x]\\s*$/i.test((el.getAttribute("aria-label") || "") + " " + (el.innerText || "")));
  const closerName = closer ? (closer.getAttribute("aria-label") || closer.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 60) : null;
  return { disabled: false, covering: describe(fixed), fixed: { top: box.top, bottom: box.bottom, height: box.height, busy, closer: closerName, dialog: fixed.matches('[role="dialog"],[aria-modal="true"],dialog') || !!fixed.querySelector('[role="dialog"],[aria-modal="true"],dialog') } };
}`;

/** The first of `points` (in the element's frame) whose top element is the element, inside it or its label; else null. */
export const VISIBLE_POINT = `function (points) {
  const mine = (node) => {
    for (let at = node; at; at = at.parentNode || at.host) if (at === this) return true;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const label = el && el.closest && el.closest("label");
    return !!label && (label.control === this || label.contains(this));
  };
  for (const [x, y] of points) {
    let hit = document.elementFromPoint(x, y);
    while (hit && hit.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
    if (hit && mine(hit)) return [x, y];
  }
  return null;
}`;

/**
 * Scrolls the element's nearest scrolling box so the element leaves the band a fixed or sticky bar covers:
 * below a bar at the top, above one at the bottom. Answers whether anything moved.
 */
export const SCROLL_CLEAR = `function (barTop, barBottom) {
  const rect = this.getBoundingClientRect();
  const viewport = innerHeight;
  let delta = 0;
  if (barTop <= viewport / 3) delta = rect.top - barBottom - 12;
  else if (barBottom >= viewport * 2 / 3) delta = rect.bottom - barTop + 12;
  if (!delta) return false;
  let box = this.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  const target = box || document.scrollingElement || document.documentElement;
  const before = target.scrollTop;
  target.scrollTop = before + delta;
  return Math.abs(target.scrollTop - before) >= 1;
}`;

export interface Receives {
  disabled: boolean;
  covering: string | null;
  fixed?: { top: number; bottom: number; height: number; busy: boolean; closer: string | null; dialog: boolean } | null;
}

/** Points across a quad, middle first, kept a few pixels inside its edges. */
export function samplePoints(quad: number[]): Array<[number, number]> {
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const inset = (low: number, high: number, at: number) => low + Math.min(3, (high - low) / 4) + (high - low - 2 * Math.min(3, (high - low) / 4)) * at;
  const points: Array<[number, number]> = [];
  for (const fy of [0.5, 0.2, 0.8, 0]) for (const fx of [0.5, 0.2, 0.8, 0, 1]) points.push([inset(left, right, fx), inset(top, bottom, fy)]);
  return points;
}

/** What to tell the bot when a fixed bar stays over the element. */
export function coverAdvice(receives: Receives): string {
  const fixed = receives.fixed;
  if (!fixed) return `The element is covered by ${receives.covering}, which would get the click.`;
  const what = fixed.dialog ? `a dialog (${receives.covering})` : `${receives.covering}, which stays fixed on the screen`;
  const way = fixed.closer ? ` Close it first: it has a button named ${JSON.stringify(fixed.closer)} (role=button[name=${JSON.stringify(fixed.closer)}]).`
    : fixed.dialog ? " Answer or close that dialog first." : " Close or dismiss it first, or reach the element another way.";
  return `The element is under ${what}, and scrolling does not uncover it.${way}`;
}
