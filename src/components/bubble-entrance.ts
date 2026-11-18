import { SEND_FLOW, springTiming } from "@/hooks/use-arrival-flow";

/** The person's bubble comes in where it rests: a fade and a small grow from its tail corner, on the same short ease-out
 * as the column's follow, which is its only movement, so nothing flies across the chat. */
export const SEND_ENTER = SEND_FLOW;
export const SEND_ENTER_FROM = 0.96;
/** A reply grows out of its top corner, by the mascot, then its words fade in whole. */
export const REPLY_GROW = springTiming(420, 32);
export const REPLY_GROW_FROM = 0.94;
export const REPLY_WORDS = { duration: 200, delay: 90, easing: "cubic-bezier(0.22, 1, 0.36, 1)" } as const;

const STALE_MS = 2_000;
let launch: { sendId: string; at: number } | null = null;

/** A send from this window's composer, noted as it goes, so only its own bubble plays the entrance. */
export function noteSendLaunch(sendId: string): void {
  launch = { sendId, at: Date.now() };
}

export function hasSendLaunch(sendId: string | undefined): boolean {
  return Boolean(sendId && launch?.sendId === sendId && Date.now() - launch.at < STALE_MS);
}

const canAnimate = (el: Element) => typeof (el as HTMLElement).animate === "function";

/** The person's bubble fades in and grows a hair from its bottom end corner, by the composer; under reduced motion it
 * only fades. Transform and opacity alone, so it runs on the compositor and the layer it needs lives only as long. */
export function enterFromComposer(bubble: HTMLElement, sendId: string | undefined, reduced: boolean): void {
  if (!hasSendLaunch(sendId) || !canAnimate(bubble)) return;
  launch = null;
  const rtl = getComputedStyle(bubble).direction === "rtl";
  bubble.style.transformOrigin = rtl ? "0% 100%" : "100% 100%";
  bubble.animate(reduced
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: `scale(${SEND_ENTER_FROM})` }, { opacity: 1, transform: "scale(1)" }], SEND_ENTER);
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
