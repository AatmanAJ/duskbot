const PRESSABLE = ".mobile-press, .mobile-row";
const FADE_MS = 320;

/** Android's press: a ripple spreads from the finger across the pressed control and fades once it lifts. */
export function installRipples(root: Document | HTMLElement = document): () => void {
  const down = (event: Event) => {
    const { clientX, clientY, target } = event as PointerEvent;
    const el = target instanceof Element ? target.closest<HTMLElement>(PRESSABLE) : null;
    if (!el || el.matches(":disabled")) return;
    const box = el.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    el.style.setProperty("--m-rx", `${x}px`);
    el.style.setProperty("--m-ry", `${y}px`);
    el.style.setProperty("--m-rip-max", `${Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y))}px`);
    delete el.dataset.ripple;
    void el.offsetWidth;
    el.dataset.ripple = "in";
    const up = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.dataset.ripple = "out";
      window.setTimeout(() => { if (el.dataset.ripple === "out") delete el.dataset.ripple; }, FADE_MS);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  root.addEventListener("pointerdown", down, { passive: true });
  return () => root.removeEventListener("pointerdown", down);
}
