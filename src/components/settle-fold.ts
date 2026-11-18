import { useLayoutEffect, useRef } from "react";

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

/** A card answered on screen shrinks into its settled row: the open card fades and shrinks a hair from its top while the
 * height folds to the row's and the corners tighten with it, then the row's summary slides in beside its name. */
export const SETTLE_FOLD = {
  shrink: { duration: 160, easing: EASE_OUT },
  shrinkTo: 0.98,
  fold: { duration: 220, easing: "cubic-bezier(0.645, 0.045, 0.355, 1)" },
  radius: { open: 24, row: 18 },
  summary: { duration: 160, delay: 120, easing: EASE_OUT },
  summaryShift: 4,
} as const;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** The open card is kept, out of React's tree, over the row until the fold is over. A card that was already settled when
 * it mounted stays still; under reduced motion the row's summary only fades in. */
export function useSettleFold<T extends HTMLElement>(settled: boolean) {
  const ref = useRef<T>(null);
  const open = useRef<{ card: HTMLElement | null; height: number } | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!settled) {
      open.current = { card: node.firstElementChild as HTMLElement | null, height: node.offsetHeight };
      return;
    }
    const was = open.current;
    open.current = null;
    if (!was || typeof node.animate !== "function") return;
    const row = node.firstElementChild as HTMLElement | null;
    const summary = row?.querySelector<HTMLElement>("[data-settled-summary]") ?? row;
    if (reducedMotion()) {
      summary?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SETTLE_FOLD.summary.duration, easing: SETTLE_FOLD.summary.easing });
      return;
    }
    const ghost = was.card && was.card !== row && !was.card.isConnected ? was.card : null;
    if (ghost) {
      Object.assign(ghost.style, { position: "absolute", top: "0", left: "0", right: "0", pointerEvents: "none", transformOrigin: "50% 0" });
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      node.style.position = "relative";
      node.appendChild(ghost);
      ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `scale(${SETTLE_FOLD.shrinkTo})` }], { ...SETTLE_FOLD.shrink, fill: "forwards" });
    }
    const to = node.offsetHeight;
    const corners = (px: number) => `inset(0 round ${px}px)`;
    const fold = node.animate([
      { height: `${was.height}px`, clipPath: corners(SETTLE_FOLD.radius.open) },
      { height: `${to}px`, clipPath: corners(SETTLE_FOLD.radius.row) },
    ], SETTLE_FOLD.fold);
    const done = () => {
      ghost?.remove();
      node.style.position = "";
    };
    fold.onfinish = done;
    fold.oncancel = done;
    const shift = getComputedStyle(node).direction === "rtl" ? SETTLE_FOLD.summaryShift : -SETTLE_FOLD.summaryShift;
    summary?.animate([{ opacity: 0, transform: `translateX(${shift}px)` }, { opacity: 1, transform: "none" }], { ...SETTLE_FOLD.summary, fill: "backwards" });
  });
  return ref;
}
