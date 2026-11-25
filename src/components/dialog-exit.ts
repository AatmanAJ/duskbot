import { useLayoutEffect, useRef } from "react";
import { cssCurve, desktopMotion } from "@/lib/desktop-motion";
import { motionReduced, playGhostExit } from "@/lib/ghost-exit";
import { pacedMs } from "@/lib/motion-speed";

/** A dialog that unmounts at once leaves as the desktop pick's dialogs do, on a copy: spread the ref on its scrim, `box`
 * selects the dialog inside it. */
export function useDialogExit<T extends HTMLElement>(box: string) {
  const scrim = useRef<T>(null);
  useLayoutEffect(() => {
    const el = scrim.current;
    return () => {
      const motion = desktopMotion();
      if (motion.pick === "a" || !el || motionReduced()) return;
      const { leave } = motion.dialog;
      playGhostExit(el, document.body, (ghost) => {
        const timing = { duration: pacedMs(leave.ms), easing: cssCurve(null), fill: "forwards" as const };
        const dialog = ghost.querySelector(box);
        return [
          ghost.animate([{ opacity: 1 }, { opacity: 0 }], timing),
          dialog?.animate([{ transform: "none" }, { transform: `translateY(${leave.y}px) scale(${leave.scale})` }], timing),
        ].filter((run): run is Animation => Boolean(run));
      });
    };
  }, [box]);
  return scrim;
}
