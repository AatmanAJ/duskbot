import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { ChevronLeft, X } from "../icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { canScroll, ownsDrag, useDrag } from "./gesture";
import { dismiss, projectRelease, rubberband, settleTo, springPath, system } from "./motion";
import { RoundButton } from "./RoundButton";

const EXIT = { stiffness: 520, damping: 46 };
const SYSTEM = { stiffness: system.stiffness, damping: system.damping };

/** The page under an open sheet steps back as the sheet rises (iOS's page sheet): it shrinks a little toward the top and
 * rounds its corners, so the sliver above the sheet reads as the page behind, not as its header peeking out. */
export function recedeStyle(progress: number): { transform: string; borderRadius: string } | null {
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0) return null;
  return { transform: `translate3d(0, calc(var(--m-safe-top) * ${(p * 0.5).toFixed(3)}), 0) scale(${(1 - 0.07 * p).toFixed(4)})`, borderRadius: `${(p * 14).toFixed(1)}px` };
}
const OPEN_SHEETS: Array<() => void> = [];

type Run = { stop: () => void };

/** The rise as keyframes the compositor plays, the sheet, its scrim and the page stepping back together: a sheet whose
 * content is still mounting (a bot's panel) never stalls its first frames. `y` takes over where it is on landing or
 * on `stop` (a finger taking the sheet). */
export function riseOnCompositor(layers: { sheet: HTMLElement; scrim: HTMLElement | null; page: HTMLElement | null }, y: MotionValue<number>, height: number, onDone: () => void): Run {
  const path = springPath(height, 0, -system.push * height, SYSTEM);
  const options: KeyframeAnimationOptions = { duration: path.duration, easing: "linear", fill: "forwards" };
  const progress = (p: number) => Math.max(0, Math.min(1, 1 - p / Math.max(1, height)));
  if (layers.page) Object.assign(layers.page.style, { transformOrigin: "50% 0", borderRadius: recedeStyle(1)!.borderRadius });
  const runs = [
    layers.sheet.animate(path.points.map((p) => ({ transform: `translateY(${p}px)` })), options),
    layers.scrim?.animate(path.points.map((p) => ({ opacity: progress(p) })), options),
    layers.page?.animate(path.points.map((p) => ({ transform: recedeStyle(progress(p))?.transform ?? "none" })), options),
  ].filter((run): run is Animation => Boolean(run));
  let over = false;
  const hand = (at: number) => {
    if (over) return;
    over = true;
    y.set(at);
    for (const run of runs) run.cancel();
  };
  runs[0]!.onfinish = () => { if (!over) { hand(0); onDone(); } };
  return {
    stop: () => {
      if (over) return;
      hand(new DOMMatrixReadOnly(getComputedStyle(layers.sheet).transform).m42);
      onDone();
    },
  };
}

/** A full screen layer that is not a sheet (the picture viewer) closes on Android's back as one does. */
export function closesOnBack(close: () => void): () => void {
  OPEN_SHEETS.push(close);
  return () => { const at = OPEN_SHEETS.indexOf(close); if (at >= 0) OPEN_SHEETS.splice(at, 1); };
}

/** Closes the top sheet, for Android's back and Escape. False when none is open. */
export function closeTopSheet(): boolean {
  const close = OPEN_SHEETS.at(-1);
  if (!close) return false;
  close();
  return true;
}

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible name when the title is not plain text. */
  label?: string;
  children: ReactNode;
  /** Fills the screen below the status bar instead of hugging its content. */
  full?: boolean;
  /** A back chevron in place of the close button, for a page inside a sheet. */
  back?: () => void;
  trailing?: ReactNode;
  bodyClassName?: string;
  /** No header row: the content draws its own. */
  flush?: boolean;
  /** False for a sheet over another sheet: the page behind already stepped back for the first one. */
  recede?: boolean;
};

/** Inside a stack of pages (Settings), a sheet page is pushed in place instead of opening over it: `back` pops it. */
export const SheetStack = createContext<{ back: () => void } | null>(null);

/** A bottom sheet with Grok's 28pt top corners. It follows the finger down from anywhere whose scroller is at its top,
 * rubber-bands up, and on release dismisses or springs back by where the flick would land. Inside a SheetStack it is a
 * page of that stack instead. */
export function Sheet(props: SheetProps) {
  const stack = useContext(SheetStack);
  return stack ? <StackPage {...props} back={props.back ?? stack.back} /> : <ModalSheet {...props} />;
}

/** One page of a stack inside a sheet: its own header (back, title, an action) over its own scroller. */
export function StackPage({ title, label, children, back, onClose, trailing, bodyClassName, flush = false }: SheetProps) {
  return (
    <section aria-label={label ?? (typeof title === "string" ? title : undefined)} className="flex h-full flex-col bg-app">
      {!flush && (
        <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-[22px]">
          {back
            ? <RoundButton label={t("mobile.sheet.back")} onClick={back} size={44}><ChevronLeft size={20} /></RoundButton>
            : <RoundButton label={t("mobile.sheet.close")} onClick={onClose} size={44}><X size={18} /></RoundButton>}
          <div className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">{title}</div>
          {trailing}
        </div>
      )}
      <div className={cn("mobile-sheet-body relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-[max(var(--m-safe-bottom),16px)]", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

function ModalSheet({ open, onClose, title, label, children, full = false, back, trailing, bodyClassName, flush = false, recede = full }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const sheetRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const height = useRef(800);
  const y = useMotionValue(typeof window === "undefined" ? 800 : window.innerHeight);
  const scrim = useTransform(y, (value) => Math.max(0, Math.min(1, 1 - value / Math.max(1, height.current))));
  const run = useRef<Run | null>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const scrimPressed = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const reduced = useReducedMotion();
  const page = useRef<HTMLElement | null>(null);
  useMotionValueEvent(scrim, "change", (progress) => {
    const nav = page.current;
    if (!nav || reduced) return;
    const style = recedeStyle(progress);
    nav.style.transform = style?.transform ?? "";
    // the page clips to its corners: rounding them a little more each frame repaints the whole page every frame, so
    // they round once as it starts to step back (the screen's own corners hide them that early) and stay so
    const corners = style ? recedeStyle(1)!.borderRadius : "";
    if (nav.style.borderRadius !== corners) nav.style.borderRadius = corners;
    if (nav.style.transformOrigin !== "50% 0px") nav.style.transformOrigin = "50% 0";
  });
  useLayoutEffect(() => {
    if (!mounted || !recede) return;
    page.current = sheetRef.current?.closest(".dusk-mobile")?.querySelector<HTMLElement>(":scope > .mobile-nav") ?? null;
    return () => {
      const nav = page.current;
      if (nav) { nav.style.transform = ""; nav.style.borderRadius = ""; }
      page.current = null;
    };
  }, [mounted, recede]);

  if (open && !mounted) setMounted(true);

  const go = useCallback((target: number, velocity: number, done?: () => void, exit = false) => {
    run.current?.stop();
    setMoving(true);
    run.current = settleTo(y, target, velocity, () => { setMoving(false); done?.(); }, exit ? EXIT : SYSTEM);
  }, [y]);
  /** a tap or Escape: the sheet accelerates away from wherever it is, quicker the less of it is left to go */
  const dismissFrom = useCallback((target: number, done: () => void) => {
    run.current?.stop();
    setMoving(true);
    const left = Math.max(0, target - y.get());
    if (reduced || left <= 0) { y.set(target); setMoving(false); done(); return; }
    const ms = Math.max(dismiss.minMs, (dismiss.ms * left) / Math.max(1, height.current));
    run.current = animate(y, target, { duration: ms / 1000, ease: dismiss.ease, onComplete: () => { setMoving(false); done(); } });
  }, [y, reduced]);

  useLayoutEffect(() => {
    if (!mounted) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    height.current = sheet.getBoundingClientRect().height;
    if (open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      y.set(height.current);
      sheet.focus({ preventScroll: true });
      // the rise starts on the first frame drawn with the sheet in place below the screen: started here, the spring's
      // clock would run through the frame that mounts its content and its first steps would lurch, then stall
      const start = requestAnimationFrame(() => {
        const el = sheetRef.current;
        if (reduced || !el || typeof el.animate !== "function") { go(0, -system.push * height.current); return; }
        run.current?.stop();
        setMoving(true);
        run.current = riseOnCompositor({ sheet: el, scrim: scrimRef.current, page: recede ? page.current : null }, y, height.current, () => setMoving(false));
      });
      return () => cancelAnimationFrame(start);
    } else {
      dismissFrom(height.current + 24, () => {
        setMounted(false);
        opener.current?.focus({ preventScroll: true });
      });
    }
  }, [open, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = () => closeRef.current();
    OPEN_SHEETS.push(close);
    return () => { OPEN_SHEETS.splice(OPEN_SHEETS.indexOf(close), 1); };
  }, [open]);

  useDrag(sheetRef, {
    axis: "y",
    enabled: mounted && open,
    claim: (s) => {
      if (ownsDrag(s.target)) return false;
      const root = sheetRef.current!;
      return s.dy > 0 ? !canScroll(s.target, root, "y", -1) : !canScroll(s.target, root, "y", 1);
    },
    onStart: () => {
      run.current?.stop();
      height.current = sheetRef.current?.getBoundingClientRect().height ?? height.current;
      setMoving(true);
    },
    onMove: (s) => y.set(s.dy > 0 ? s.dy : rubberband(s.dy, 48)),
    onEnd: (s) => {
      const landing = projectRelease(Math.max(0, y.get()), s.vy);
      if (y.get() > 0 && (landing > height.current * 0.5 || s.vy > 700)) {
        go(height.current + 24, Math.max(s.vy, 0), () => closeRef.current(), true);
      } else {
        go(0, s.vy);
      }
    },
    onCancel: () => go(0, 0),
  });

  if (!mounted) return null;
  return (
    <div className="mobile-sheet-layer fixed inset-0 z-40" data-sheet-open="" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      {/* only a press that began on the scrim closes the sheet: the finger that opened it on press lifts over it */}
      <motion.div ref={scrimRef} aria-hidden className={cn("absolute inset-0", full ? "bg-[rgb(12_12_14/0.42)]" : "bg-[rgb(12_12_14/0.30)]")} style={{ opacity: scrim }}
        onPointerDown={() => { scrimPressed.current = true; }}
        onClick={() => { if (scrimPressed.current) onClose(); scrimPressed.current = false; }} />
      <motion.div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === "string" ? title : undefined)}
        tabIndex={-1}
        className={cn(
          "mobile-sheet absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-[28px] bg-app outline-none",
          full ? "top-[calc(var(--m-safe-top)+10px)]" : "max-h-[calc(100%-var(--m-safe-top)-10px)]",
        )}
        style={{ y, willChange: moving ? "transform" : undefined }}
      >
        <div aria-hidden className={cn("mx-auto h-[5px] w-9 shrink-0 rounded-full bg-ink/[0.14]", flush ? "pointer-events-none absolute inset-x-0 top-2 z-50" : "mt-2")} />
        {!flush && (
          <div className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-1.5">
            {back
              ? <RoundButton label={t("mobile.sheet.back")} onClick={back} size={44}><ChevronLeft size={20} /></RoundButton>
              : <RoundButton label={t("mobile.sheet.close")} onClick={onClose} size={44}><X size={18} /></RoundButton>}
            <div className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</div>
            {trailing}
          </div>
        )}
        <div ref={bodyRef} className={cn("mobile-sheet-body relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-[max(var(--m-safe-bottom),16px)]", bodyClassName)}>
          {children}
        </div>
      </motion.div>
    </div>
  );
}
