import { useLayoutEffect, useRef } from "react";

/** The round button at the end of the phone's bar is a different control from one moment to the next (Send, Stop, the
 * mic, the keep tick): each newcomer takes over the last one's fill and glyph colour and turns to its own together. */
export function useSlotHandoff(on: boolean) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const was = useRef<{ el: HTMLElement; fill: string; ink: string } | null>(null);
  useLayoutEffect(() => {
    if (!on) return;
    let slot: HTMLElement | null = null;
    for (const el of actionsRef.current?.querySelectorAll<HTMLElement>(":scope > button") ?? []) {
      if (!slot || el.offsetLeft >= slot.offsetLeft) slot = el;
    }
    if (!slot) return;
    const style = getComputedStyle(slot);
    const now = { el: slot, fill: style.backgroundColor, ink: style.color };
    const before = was.current;
    was.current = now;
    if (!before || before.el === slot || !slot.isConnected || typeof slot.animate !== "function") return;
    if (before.fill === now.fill && before.ink === now.ink) return;
    slot.animate([{ backgroundColor: before.fill, color: before.ink }, { backgroundColor: now.fill, color: now.ink }], { duration: 200, easing: "ease" });
  });
  return actionsRef;
}
