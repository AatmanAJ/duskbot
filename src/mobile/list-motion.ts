import { useLayoutEffect, useRef, type RefObject } from "react";
import { contentMove, feel, prefersReducedMotion } from "./motion";

const KEY = "data-flip-key";

/** Moves between two renders of a list: rows that changed place glide from where they were, rows that are new arrive
 * through a small blur. Positions come from offsetTop, which a transform on the page around the list (a push, a sheet
 * stepping it back) does not change. Runs on `translate`, so a row's own press scale is left alone. */
export function useListFlip(listRef: RefObject<HTMLElement | null>, signature: string): void {
  const last = useRef<{ signature: string; at: Map<string, number> } | null>(null);
    useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = [...list.querySelectorAll<HTMLElement>(`[${KEY}]`)];
    // relative to the rows' own container: something above the list growing between renders is not a move
    const now = new Map(rows.map((row) => [row.getAttribute(KEY)!, row.offsetTop - (row.parentElement?.offsetTop ?? 0)]));
    const prev = last.current;
    last.current = { signature, at: now };
    if (!prev || prev.signature === signature || prefersReducedMotion()) return;
    const before = prev.at;
    let entered = 0;
    for (const row of rows) {
      const key = row.getAttribute(KEY)!;
      const was = before.get(key);
      if (was === undefined) {
        row.animate(
          [{ opacity: 0, translate: `0 ${feel.enter.y}px` }, { opacity: 1, translate: "0 0" }],
          { duration: feel.enter.fade * 1000 + 60, delay: entered++ * feel.stagger * 1000, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" },
        );
      } else if (Math.abs(was - now.get(key)!) > 0.5) {
        const delta = was - now.get(key)!;
        // added to any glide still running, so a second move mid-flight carries on from where the row is drawn
        const anim = row.animate([{ translate: `0 ${delta}px` }, { translate: "0 0" }], { duration: contentMove.ms, easing: contentMove.css, composite: "add" });
        // a row travelling past others rides over them on the page's own ground, so their text never crosses
        if (Math.abs(delta) > row.offsetHeight) {
          row.style.position = "relative";
          row.style.zIndex = "1";
          row.style.backgroundColor = "var(--color-app)";
          const settle = () => { row.style.position = ""; row.style.zIndex = ""; row.style.backgroundColor = ""; };
          anim.addEventListener("finish", settle);
          anim.addEventListener("cancel", settle);
        }
      }
    }
  });
}

/** A list that has just replaced its loading placeholder fades up into place once. */
export function revealOnce(el: HTMLElement | null): void {
  if (!el || prefersReducedMotion()) return;
  el.animate([{ opacity: 0, translate: "0 6px" }, { opacity: 1, translate: "0 0" }], { duration: feel.enter.fade * 1000 + 80, easing: "cubic-bezier(.22,1,.36,1)" });
}
