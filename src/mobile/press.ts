import { feel, prefersReducedMotion, springEasing } from "./motion";

/** Controls that already press in CSS (the shell's round buttons, the composer discs) or that move under the finger. */
const OWN_PRESS = ".mobile-press, [data-long-press], [data-composer-send], [data-voice-mic], [data-composer-stop], [data-composer-plus], [role='slider'], input, textarea, select";
const TAPPABLE = "button, a[href], [role='button'], [role='menuitem'], [role='option'], [role='tab'], [role='radio'], [role='switch'], label[for], summary";

export function pressTarget(target: EventTarget | null, root: Element): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest<HTMLElement>(TAPPABLE);
  if (!el || !root.contains(el) || el.matches(OWN_PRESS) || el.closest(OWN_PRESS)) return null;
  if (el.matches(":disabled, [aria-disabled='true']") || el.closest("[data-no-press]")) return null;
  return el;
}

/** Wide things (a chat row, a settings row) barely move; small ones press further. */
export function pressScale(width: number): number {
  return width > 180 ? feel.press.wide : feel.press.scale;
}

/** Every tappable in the phone shell sinks under the finger and springs back on release, so a tap always lands. Runs on
 * the compositor through `scale`, which leaves each control's own transform and transitions alone. A touch that turns
 * into a scroll lets go at once. */
export function installPress(root: HTMLElement): () => void {
  const release = springEasing(feel.press.release.stiffness, feel.press.release.damping);
  let held: { el: HTMLElement; anim: Animation; to: number } | null = null;

  const letGo = () => {
    if (!held) return;
    const { el, anim, to } = held;
    held = null;
    const now = Number(getComputedStyle(el).scale) || to;
    anim.cancel();
    el.animate([{ scale: String(now) }, { scale: "1" }], { duration: release.duration, easing: release.easing });
  };

  const down = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    letGo();
    if (prefersReducedMotion()) return;
    const el = pressTarget(event.target, root);
    if (!el) return;
    const to = pressScale(el.getBoundingClientRect().width);
    const anim = el.animate([{ scale: "1" }, { scale: String(to) }], { duration: feel.press.inMs, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" });
    held = { el, anim, to };
  };

  root.addEventListener("pointerdown", down, { passive: true });
  window.addEventListener("pointerup", letGo, { passive: true });
  window.addEventListener("pointercancel", letGo, { passive: true });
  // a press that becomes a scroll, or a held row that opens a menu, lets go too
  root.addEventListener("scroll", letGo, { passive: true, capture: true });
  root.addEventListener("dusk-press-release", letGo);
  return () => {
    letGo();
    root.removeEventListener("pointerdown", down);
    window.removeEventListener("pointerup", letGo);
    window.removeEventListener("pointercancel", letGo);
    root.removeEventListener("scroll", letGo, { capture: true });
    root.removeEventListener("dusk-press-release", letGo);
  };
}
