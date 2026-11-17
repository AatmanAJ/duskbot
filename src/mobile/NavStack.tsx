import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useTransform, type AnimationPlaybackControls } from "motion/react";
import { TranscriptStaging } from "@/components/transcript-staging";
import { canScroll, ownsDrag, useDrag } from "./gesture";
import { prefersReducedMotion, projectRelease, settleTo } from "./motion";

/** Parallax of the page underneath, as a share of the width: UIKit's navigation push moves it a third as far. */
const UNDER_SHIFT = 0.3;
const EXIT = { stiffness: 440, damping: 40 };
/** A tapped push starts from rest: critically damped (zeta 1), so it eases in and lands without overshoot or creep. */
const PUSH = { stiffness: 380, damping: 39, restDelta: 0.1 };
const READY_CAP_MS = 1000;

/** Resolves once a freshly mounted page is final: its transcript has mounted every row (`whole`, for a chat that builds
 * in steps), and it has painted the same height for two smooth frames. Anything still moving then would move after
 * the slide lands. Gives up waiting after `READY_CAP_MS`. */
function whenSettled(el: HTMLElement, signal: { cancelled: boolean; whole: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    let last = performance.now();
    let height = -1;
    let steady = 0;
    const tick = (now: number) => {
      if (signal.cancelled) return;
      const log = el.querySelector<HTMLElement>("[role='log']");
      const next = log ? log.scrollHeight : el.scrollHeight;
      const smooth = now - last < 25;
      last = now;
      steady = next === height && smooth ? steady + 1 : 0;
      height = next;
      const building = Boolean(log) && (log!.getAttribute("aria-busy") === "true" || (!signal.whole && el.querySelector("[data-simple-rows]") !== null));
      if ((steady >= 2 && !building) || now - started > READY_CAP_MS) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function useWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 390 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** Two layers: the list, and a page pushed over it. The page follows the finger back to the list from anywhere on it
 * (a horizontal scroller inside keeps its own drag), and a release finishes or returns by where the flick would land. */
export function NavStack({ base, page, pageKey, onBack, onSettled }: {
  base: ReactNode;
  /** The pushed page, or null for the list alone. */
  page: ReactNode | null;
  pageKey: string | null;
  onBack: () => void;
  /** The pushed page is fully in (true) or gone (false). */
  onSettled?: (shown: boolean) => void;
}) {
  const width = useWidth();
  const x = useMotionValue(width);
  const baseX = useTransform(x, (value) => -UNDER_SHIFT * (width - value));
  const dim = useTransform(x, [0, width], [1, 0]);
  const pageOpacity = useMotionValue(1);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const lastPage = useRef<ReactNode>(null);
  const [moving, setMoving] = useState(false);
  const run = useRef<AnimationPlaybackControls | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  if (page) lastPage.current = page;

  const go = useCallback((target: number, velocity: number, done?: () => void, push = false) => {
    run.current?.stop();
    setMoving(true);
    const finish = () => { setMoving(false); done?.(); };
    if (prefersReducedMotion()) {
      x.set(target === 0 ? 0 : width);
      pageOpacity.set(target === 0 ? 0 : 1);
      run.current = settleTo(pageOpacity, target === 0 ? 1 : 0, 0, finish);
      return;
    }
    run.current = settleTo(x, target, velocity, finish, target === 0 ? (push ? PUSH : undefined) : EXIT);
  }, [x, pageOpacity, width]);

  // the page mounts offscreen on its own layer and slides only once it has painted, so its mount cost never eats frames
  const preparing = useRef<{ cancelled: boolean; whole: boolean } | null>(null);
  const push = useCallback(() => {
    if (preparing.current) preparing.current.cancelled = true;
    const signal = { cancelled: false, whole: false };
    preparing.current = signal;
    run.current?.stop();
    x.set(width);
    pageOpacity.set(prefersReducedMotion() ? 0 : 1);
    setMoving(true);
    requestAnimationFrame(() => {
      const el = pageRef.current;
      const ready = el ? whenSettled(el, signal) : Promise.resolve();
      void ready.then(() => {
        if (signal.cancelled) return;
        preparing.current = null;
        go(0, 0, () => settled.current?.(true), true);
      });
    });
  }, [go, x, pageOpacity, width]);

  useLayoutEffect(() => {
    if (pageKey && page) {
      if (shownKey === pageKey) return;
      // a page swapped for another (a notification opening a different chat) cuts over; only list to page slides
      if (shownKey && x.get() < width / 2) { setShownKey(pageKey); return; }
      setShownKey(pageKey);
      push();
    } else if (shownKey) {
      if (preparing.current) { preparing.current.cancelled = true; preparing.current = null; }
      go(width, 0, () => { setShownKey(null); lastPage.current = null; settled.current?.(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, Boolean(page)]);

  useEffect(() => { if (shownKey && !moving) x.set(0); }, [width]); // eslint-disable-line react-hooks/exhaustive-deps

  useDrag(pageRef, {
    axis: "x",
    enabled: Boolean(shownKey),
    claim: (s) => s.dx > 0 && !ownsDrag(s.target) && !canScroll(s.target, pageRef.current!, "x", -1),
    onStart: () => {
      run.current?.stop();
      setMoving(true);
      const active = document.activeElement;
      if (active instanceof HTMLElement && pageRef.current?.contains(active)) active.blur();
    },
    onMove: (s) => x.set(Math.max(0, s.dx)),
    onEnd: (s) => {
      const landing = projectRelease(x.get(), s.vx);
      if ((landing > width / 2 && s.vx > -200) || s.vx > 500) {
        go(width, Math.max(s.vx, 0), () => { setShownKey(null); lastPage.current = null; settled.current?.(false); onBack(); });
      } else {
        go(0, s.vx);
      }
    },
    onCancel: () => go(0, 0),
  });

  const pageShown = Boolean(shownKey);
  // a constant value: the slide starting or landing never re-renders the chat underneath it
  const staging = useMemo(() => ({ onWhole: () => { if (preparing.current) preparing.current.whole = true; } }), []);
  return (
    <div className="mobile-nav relative h-full w-full overflow-hidden bg-app">
      <motion.div
        className="absolute inset-0"
        style={{ x: pageShown ? baseX : 0, willChange: moving ? "transform" : undefined }}
        inert={pageShown && !moving ? true : undefined}
        aria-hidden={pageShown && !moving ? true : undefined}
      >
        {base}
        {pageShown && <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-[rgb(10_10_12/0.16)]" style={{ opacity: dim }} />}
      </motion.div>
      {pageShown && (
        <motion.div
          ref={pageRef}
          key={shownKey}
          className="mobile-page absolute inset-0 bg-app"
          style={{ x, opacity: pageOpacity, willChange: moving ? "transform" : undefined }}
        >
          <TranscriptStaging value={staging}>{page ?? lastPage.current}</TranscriptStaging>
        </motion.div>
      )}
    </div>
  );
}
