import { useEffect, type RefObject } from "react";
import { keyboardInset } from "@/lib/phone-viewport";
import { keyboardCurve, prefersReducedMotion } from "./motion";
import type { MobilePlatform } from "./platform";

/** The open chat's transcript scroller, kept still on screen while the layout under it changes. */
function scroller(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-mobile-chat] .glass-scroller");
}

const AT_END_PX = 24;
const INTERACTIVE = "a, button, input, textarea, select, summary, label, [role=button], [role=menuitem], [contenteditable=true]";

function atEnd(list: HTMLElement): boolean {
  return list.scrollHeight - list.clientHeight - list.scrollTop <= AT_END_PX;
}

/** Opening the keyboard is for answering: the transcript goes to its newest row, as a messaging app's does. */
function toLatest(root: HTMLElement): void {
  const list = scroller(root);
  if (list) list.scrollTop = list.scrollHeight;
}

/** The composer's field, when it holds focus (the keyboard is up for it). */
function composerField(root: HTMLElement): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLTextAreaElement && root.querySelector("[data-mobile-chat]")?.contains(active) ? active : null;
}

/** A drag down the transcript, or a tap on it away from a control, puts the keyboard away (UIScrollView's
 * keyboardDismissMode onDrag, as Messages and WhatsApp do). */
export function useKeyboardDismiss(platform: MobilePlatform, rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let start: { x: number; y: number } | null = null;
    const inTranscript = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("[data-mobile-chat] .glass-scroller"));
    const dismiss = () => {
      if (root.dataset.glassFocused !== undefined) { platform.glass?.blur(); return; }
      const field = composerField(root);
      if (!field) return;
      field.blur();
      platform.hideKeyboard?.();
    };
    const down = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = touch && event.touches.length === 1 && inTranscript(event.target) ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!start || !touch) return;
      const dy = touch.clientY - start.y;
      if (dy > 16 && dy > Math.abs(touch.clientX - start.x) * 1.5) { start = null; dismiss(); }
    };
    const up = () => { start = null; };
    const tap = (event: MouseEvent) => {
      if (!inTranscript(event.target) || (event.target as Element).closest(INTERACTIVE)) return;
      if (window.getSelection()?.toString()) return;
      dismiss();
    };
    root.addEventListener("touchstart", down, { passive: true });
    root.addEventListener("touchmove", move, { passive: true });
    root.addEventListener("touchend", up, { passive: true });
    root.addEventListener("touchcancel", up, { passive: true });
    root.addEventListener("click", tap);
    return () => {
      root.removeEventListener("touchstart", down);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", up);
      root.removeEventListener("touchcancel", up);
      root.removeEventListener("click", tap);
    };
  }, [platform, rootRef]);
}

function safeBottom(root: HTMLElement): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--m-safe-bottom)";
  root.appendChild(probe);
  const value = probe.getBoundingClientRect().height;
  probe.remove();
  return value;
}

/** Moves the chat with the software keyboard. Natively the keyboard announces itself before it moves, so the transcript
 * and composer ride up on the compositor with the keyboard's own curve, and the layout takes the space only once it has
 * settled (and gives it back before it leaves), each swap paired with a scroll offset so nothing visibly jumps. In a
 * browser the visual viewport is the only signal and the browser already animates it, so the inset simply follows. */
export function useKeyboardSync(platform: MobilePlatform, rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const curve = platform.kind === "android" ? keyboardCurve.android : keyboardCurve.ios;
    root.style.setProperty("--m-kb-dur", `${prefersReducedMotion() ? 0.01 : curve.duration}s`);
    root.style.setProperty("--m-kb-ease", curve.css);
    let committed = 0;
    let settleTimer = 0;

    const set = (kb: number, shift: number) => {
      root.style.setProperty("--m-kb", `${kb}px`);
      root.style.setProperty("--m-kb-shift", `${shift}px`);
    };
    const commitShown = (height: number) => {
      window.clearTimeout(settleTimer);
      if (committed === height) return;
      const shift = Math.max(0, height - safeBottom(root));
      delete root.dataset.kbMoving;
      const list = scroller(root);
      set(height, 0);
      if (list) list.scrollTop += shift - Math.max(0, committed - safeBottom(root));
      committed = height;
    };

    // android resizes the whole webview with the window (adjustResize; the keyboard plugin's resize mode is ios only), so
    // there the layout already ends at the keyboard and only ios gets the ride-along choreography
    if (platform.kind === "android") return;
    if (platform.onKeyboard) {
      const stop = platform.onKeyboard(({ height, phase }) => {
        if (height > 0) {
          if (phase === "did") { commitShown(height); return; }
          if (!committed && !root.dataset.keyboard) toLatest(root);
          const shift = Math.max(0, height - Math.max(committed, safeBottom(root)));
          root.dataset.kbMoving = "";
          root.dataset.keyboard = "open";
          root.style.setProperty("--m-kb-shift", `${shift}px`);
          window.clearTimeout(settleTimer);
          settleTimer = window.setTimeout(() => commitShown(height), curve.duration * 1000 + 40);
          return;
        }
        if (phase === "did") { delete root.dataset.kbMoving; return; }
        window.clearTimeout(settleTimer);
        const shift = Math.max(0, committed - safeBottom(root));
        delete root.dataset.kbMoving;
        delete root.dataset.keyboard;
        const list = scroller(root);
        set(0, shift);
        if (list) list.scrollTop -= shift;
        committed = 0;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          root.dataset.kbMoving = "";
          root.style.setProperty("--m-kb-shift", "0px");
        }));
      });
      return () => { stop(); window.clearTimeout(settleTimer); };
    }

    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = keyboardInset(window.innerHeight, vv);
        if (inset && (window.scrollY > 0 || vv.offsetTop > 0)) window.scrollTo(0, 0);
        if (inset === committed) return;
        const list = scroller(root);
        // the newest row stays in view as the keyboard takes its space; opening it goes to the newest row
        const pin = Boolean(list && (atEnd(list) || (inset > 0 && committed === 0)));
        committed = inset;
        set(inset, 0);
        if (pin) toLatest(root);
        if (inset) root.dataset.keyboard = "open";
        else delete root.dataset.keyboard;
        if (inset && (window.scrollY > 0 || vv.offsetTop > 0)) window.scrollTo(0, 0);
      });
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, [platform, rootRef]);
}
