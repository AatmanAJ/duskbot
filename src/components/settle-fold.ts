import { useLayoutEffect, useRef } from "react";

const FOLD_MS = 200;
const FOLD_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** A card answered while on screen folds into its settled row: the height eases from the open card's to the row's as
 * the row fades in. A card that was already settled when it mounted stays still, and so does everything under reduced motion. */
export function useSettleFold<T extends HTMLElement>(settled: boolean) {
  const ref = useRef<T>(null);
  const openHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!settled) {
      openHeight.current = node.offsetHeight;
      return;
    }
    const from = openHeight.current;
    openHeight.current = null;
    if (from === null || typeof node.animate !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const to = node.offsetHeight;
    if (Math.abs(from - to) < 1) return;
    node.style.overflow = "hidden";
    const fold = node.animate([{ height: `${from}px`, opacity: 0 }, { height: `${to}px`, opacity: 1 }], { duration: FOLD_MS, easing: FOLD_EASE });
    const done = () => { node.style.overflow = ""; };
    fold.onfinish = done;
    fold.oncancel = done;
  });
  return ref;
}
