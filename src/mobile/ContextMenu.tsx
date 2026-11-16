import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { haptic } from "./haptics";
import { dur, ease, prefersReducedMotion, spring, withFade } from "./motion";

export interface ContextAction {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

const HOLD_MS = 430;
const MOVE_CANCEL = 8;

/** Press and hold: the element sinks to .97 over the hold so the hand feels it coming, then a medium tap and the menu.
 * A right click or the context-menu key opens it at once (web preview, keyboards). The click that follows a hold is
 * swallowed so the row does not also open. */
export function useLongPress(ref: RefObject<HTMLElement | null>, onOpen: (rect: DOMRect) => void, enabled = true) {
  const latest = useRef(onOpen);
  latest.current = onOpen;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    let fired = false;
    const reduced = prefersReducedMotion();
    const sink = (on: boolean) => {
      el.style.transition = on ? `scale ${HOLD_MS}ms cubic-bezier(.22,1,.36,1)` : "scale .2s cubic-bezier(.28,1.4,.36,1)";
      el.style.scale = on && !reduced ? "0.97" : "";
    };
    const cancel = () => { window.clearTimeout(timer); timer = 0; start = null; sink(false); };
    const fire = () => {
      timer = 0;
      fired = true;
      sink(false);
      haptic("medium");
      latest.current(el.getBoundingClientRect());
    };
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { cancel(); return; }
      fired = false;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      sink(true);
      timer = window.setTimeout(fire, HOLD_MS);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start || !timer) return;
      const touch = event.touches[0];
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_CANCEL) cancel();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (fired && event.cancelable) event.preventDefault();
      cancel();
    };
    const onClick = (event: MouseEvent) => {
      if (!fired) return;
      fired = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      if (timer || fired) return;
      haptic("medium");
      latest.current(el.getBoundingClientRect());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        latest.current(el.getBoundingClientRect());
      }
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", cancel);
    el.addEventListener("click", onClick, true);
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("keydown", onKeyDown);
    return () => {
      cancel();
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", cancel);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, enabled]);
}

const MENU_W = 250;
const ROW_H = 46;
const GAP = 10;
const MARGIN = 12;

/** iOS's context menu, in our motion: the held item lifts in place over a blurred page, and the actions open from its
 * edge. If the menu would run off screen the item and menu move up together. */
export function ContextMenu({ open, anchor, preview, actions, label, onClose }: {
  open: boolean;
  anchor: DOMRect | null;
  preview: ReactNode;
  actions: ContextAction[];
  label: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ top: number; left: number; menuTop: number; menuLeft: number; above: boolean; shift: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const vh = window.innerHeight, vw = window.innerWidth;
    const menuH = actions.length * ROW_H + 12;
    const safeTop = 54, safeBottom = 34;
    let top = anchor.top;
    const below = top + anchor.height + GAP + menuH;
    let above = false;
    let shift = 0;
    if (below > vh - safeBottom - MARGIN) {
      if (anchor.top - GAP - menuH > safeTop + MARGIN) above = true;
      else { shift = below - (vh - safeBottom - MARGIN); top -= shift; }
    }
    const menuLeft = Math.min(Math.max(MARGIN, anchor.left + (anchor.width > MENU_W * 1.4 ? 16 : 0)), vw - MENU_W - MARGIN);
    const menuTop = above ? top - GAP - menuH : top + anchor.height + GAP;
    setLayout({ top, left: anchor.left, menuTop, menuLeft, above, shift });
  }, [open, anchor, actions.length]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && anchor && layout && (
        <div className="dusk-mobile-overlay fixed inset-0 z-50" key="context">
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-[rgb(23_24_26/0.22)] [-webkit-backdrop-filter:blur(5px)] [backdrop-filter:blur(5px)]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.14 } }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute"
            style={{ left: layout.left, top: anchor.top, width: anchor.width, height: anchor.height }}
            initial={{ scale: 0.97, y: 0 }}
            animate={{ scale: 1.02, y: layout.top - anchor.top }}
            exit={{ scale: 1, y: 0, opacity: 0, transition: { duration: 0.12, ease: ease.out } }}
            transition={withFade(spring.popover)}
          >
            <div className="size-full overflow-hidden rounded-[18px] bg-app shadow-[0_12px_40px_-8px_rgb(10_10_12/0.28)]">{preview}</div>
          </motion.div>
          <motion.div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className="m-glass-thick absolute overflow-hidden rounded-[22px] py-1.5"
            style={{ left: layout.menuLeft, top: layout.menuTop, width: MENU_W, transformOrigin: layout.above ? "left bottom" : "left top" }}
            initial={{ opacity: 0, scale: 0.9, y: layout.above ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.08, ease: ease.out } }}
            transition={{ ...spring.popover, opacity: { duration: dur.fast } }}
          >
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => { haptic("selection"); onClose(); action.onSelect(); }}
                className={cn(
                  "mobile-row flex h-[46px] w-full items-center gap-3 px-4 text-left text-[16px] disabled:opacity-40",
                  action.danger ? "text-danger" : "text-ink",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {action.icon && <span aria-hidden className="shrink-0 opacity-80">{action.icon}</span>}
              </button>
            ))}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.querySelector(".dusk-mobile") ?? document.body,
  );
}
