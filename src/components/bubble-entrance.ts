import { springTiming } from "@/hooks/use-arrival-flow";

/** The person's words leave the field and settle into their bubble as its fill comes in. */
export const SEND_MOVE = { duration: 240, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)" } as const;
export const SEND_FILL = { duration: 220, delay: 40, easing: "cubic-bezier(0.22, 1, 0.36, 1)" } as const;
/** A reply grows out of its top corner, by the mascot, then its words fade in whole. */
export const REPLY_GROW = springTiming(420, 32);
export const REPLY_GROW_FROM = 0.94;
export const REPLY_WORDS = { duration: 200, delay: 90, easing: "cubic-bezier(0.22, 1, 0.36, 1)" } as const;

interface Launch { sendId: string; x: number; y: number; scale: number; at: number }

const STALE_MS = 2_000;
let launch: Launch | null = null;

/** Where the typed words start in the field, noted as they are sent, for the bubble that carries them. */
export function noteSendLaunch(sendId: string, field: HTMLElement | null): void {
  launch = null;
  if (!field) return;
  const box = field.getBoundingClientRect();
  if (!box.width || !field.offsetWidth) return;
  const scale = box.width / field.offsetWidth;
  const style = getComputedStyle(field);
  launch = { sendId, scale, at: Date.now(),
    x: box.left + (parseFloat(style.paddingLeft) || 0) * scale, y: box.top + (parseFloat(style.paddingTop) || 0) * scale };
}

export function hasSendLaunch(sendId: string | undefined): boolean {
  return Boolean(sendId && launch?.sendId === sendId && Date.now() - launch.at < STALE_MS);
}

function takeSendLaunch(sendId: string | undefined): Launch | null {
  if (!hasSendLaunch(sendId)) return null;
  const taken = launch;
  launch = null;
  return taken;
}

const canAnimate = (el: Element) => typeof (el as HTMLElement).animate === "function";

/** Moves the bubble from where its words were typed to where it rests, while `fill` (its background, drawn under the
 * words) fades in. Resolves when the fill is whole, or at once when there is nothing to play. */
export function morphFromComposer(bubble: HTMLElement, fill: HTMLElement | null, sendId: string | undefined): Promise<void> {
  const from = takeSendLaunch(sendId);
  if (!from || !canAnimate(bubble)) return Promise.resolve();
  const box = bubble.getBoundingClientRect();
  const style = getComputedStyle(bubble);
  const dx = (from.x - (box.left + (parseFloat(style.paddingLeft) || 0) * from.scale)) / from.scale;
  const dy = (from.y - (box.top + (parseFloat(style.paddingTop) || 0) * from.scale)) / from.scale;
  bubble.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }], SEND_MOVE);
  if (!fill || !canAnimate(fill)) return Promise.resolve();
  const fading = fill.animate([{ opacity: 0 }, { opacity: 1 }], { ...SEND_FILL, fill: "backwards" });
  return new Promise((resolve) => {
    fading.addEventListener("finish", () => resolve());
    fading.addEventListener("cancel", () => resolve());
  });
}

/** The reply grows out of its top start corner, the mascot's side, so its top edge moves only with the conversation;
 * its words fade in once it is there. Under reduced motion it only fades. */
export function growFromMascot(bubble: HTMLElement, reduced: boolean, wordsRevealed = false): void {
  if (!canAnimate(bubble)) return;
  const rtl = getComputedStyle(bubble).direction === "rtl";
  bubble.style.transformOrigin = rtl ? "100% 0%" : "0% 0%";
  bubble.animate(reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: `scale(${REPLY_GROW_FROM})` }, { opacity: 1, transform: "scale(1)" }], REPLY_GROW);
  if (wordsRevealed) return;
  for (const part of bubble.children) {
    if (canAnimate(part)) part.animate([{ opacity: 0 }, { opacity: 1 }], { ...REPLY_WORDS, fill: "backwards" });
  }
}
