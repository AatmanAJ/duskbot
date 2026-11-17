import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { TranscriptStaging } from "@/components/transcript-staging";
import { canScroll, ownsDrag, useDrag } from "./gesture";
import { prefersReducedMotion, projectRelease, settleTo, spring, springPath } from "./motion";

/** Parallax of the page underneath, as a share of the width: UIKit's navigation push moves it a third as far. */
const UNDER_SHIFT = 0.3;
const EXIT = { stiffness: 440, damping: 40 };
/** A tapped push starts from rest: critically damped (zeta 1), so it eases in and lands without overshoot or creep. */
const PUSH = { stiffness: 380, damping: 39 };
/** A chat still loading its transcript slides in once it has it, or after this long with its loading rows. */
const LOAD_WAIT_MS = 150;

type Run = { stop: () => void };

/** Resolves once a freshly mounted page has painted, and its transcript has loaded or `LOAD_WAIT_MS` has passed. */
function whenPainted(el: HTMLElement, signal: { cancelled: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = (now: number) => {
      if (signal.cancelled) return;
      const loading = el.querySelector("[role='log'][aria-busy='true']") !== null;
      if (!loading || now - started > LOAD_WAIT_MS) resolve();
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

/** The page, the list under it and its dim, moved together as keyframes the compositor plays: a busy page thread (a chat
 * mounting, a reply streaming) never stalls the slide. On landing or `stop` the motion values take over where it is. */
function slideLayers(layers: { page: HTMLElement; base: HTMLElement | null; dim: HTMLElement | null }, x: MotionValue<number>, width: number, path: { duration: number; points: number[] }, onDone: () => void): Run {
  const options: KeyframeAnimationOptions = { duration: path.duration, fill: "forwards", easing: "linear" };
  const runs = [
    layers.page.animate(path.points.map((p) => ({ transform: `translateX(${p}px)` })), options),
    layers.base?.animate(path.points.map((p) => ({ transform: `translateX(${-UNDER_SHIFT * (width - p)}px)` })), options),
    layers.dim?.animate(path.points.map((p) => ({ opacity: 1 - p / width })), options),
  ].filter((run): run is Animation => Boolean(run));
  let over = false;
  const hand = (at: number) => {
    if (over) return;
    over = true;
    for (const run of runs) {
      try { run.commitStyles(); } catch { /* an element already gone */ }
      run.cancel();
    }
    x.set(at);
  };
  runs[0]!.onfinish = () => { if (!over) { hand(path.points.at(-1)!); onDone(); } };
  return {
    stop: () => {
      if (over) return;
      hand(new DOMMatrixReadOnly(getComputedStyle(layers.page).transform).m41);
    },
  };
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
  const run = useRef<Run | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  if (page) lastPage.current = page;

  // the page's older rows wait while it moves: they mount once it lands, and never for a page on its way out
  const sliding = useRef(false);
  const waiting = useRef(new Set<() => void>());
  const landed = useCallback(() => {
    sliding.current = false;
    const steps = [...waiting.current];
    waiting.current.clear();
    for (const step of steps) step();
  }, []);
  const gone = useCallback(() => {
    sliding.current = false;
    waiting.current.clear();
  }, []);
  const staging = useMemo<TranscriptStaging>(() => ({
    afterSlide: (step) => {
      if (!sliding.current) { step(); return () => {}; }
      waiting.current.add(step);
      return () => { waiting.current.delete(step); };
    },
  }), []);

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
    const page = pageRef.current;
    const curve = target === 0 ? (push ? PUSH : spring.settle) : EXIT;
    if (!page || typeof page.animate !== "function") {
      run.current = settleTo(x, target, velocity, finish, curve);
      return;
    }
    run.current = slideLayers({ page, base: baseRef.current, dim: dimRef.current }, x, width, springPath(x.get(), target, velocity, curve), finish);
  }, [x, pageOpacity, width]);

  // the page mounts offscreen with its newest rows, and slides once it has painted them
  const preparing = useRef<{ cancelled: boolean } | null>(null);
  const push = useCallback(() => {
    if (preparing.current) preparing.current.cancelled = true;
    const signal = { cancelled: false };
    preparing.current = signal;
    sliding.current = true;
    run.current?.stop();
    x.set(width);
    pageOpacity.set(prefersReducedMotion() ? 0 : 1);
    setMoving(true);
    requestAnimationFrame(() => {
      const el = pageRef.current;
      const ready = el ? whenPainted(el, signal) : Promise.resolve();
      void ready.then(() => {
        if (signal.cancelled) return;
        preparing.current = null;
        go(0, 0, () => { landed(); settled.current?.(true); }, true);
      });
    });
  }, [go, landed, x, pageOpacity, width]);

  useLayoutEffect(() => {
    if (pageKey && page) {
      if (shownKey === pageKey) return;
      // a page swapped for another (a notification opening a different chat) cuts over; only list to page slides
      if (shownKey && x.get() < width / 2) { setShownKey(pageKey); return; }
      setShownKey(pageKey);
      push();
    } else if (shownKey) {
      if (preparing.current) { preparing.current.cancelled = true; preparing.current = null; }
      sliding.current = true;
      go(width, 0, () => { setShownKey(null); lastPage.current = null; gone(); settled.current?.(false); });
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
      sliding.current = true;
      setMoving(true);
      const active = document.activeElement;
      if (active instanceof HTMLElement && pageRef.current?.contains(active)) active.blur();
    },
    onMove: (s) => x.set(Math.max(0, s.dx)),
    onEnd: (s) => {
      const landing = projectRelease(x.get(), s.vx);
      if ((landing > width / 2 && s.vx > -200) || s.vx > 500) {
        go(width, Math.max(s.vx, 0), () => { setShownKey(null); lastPage.current = null; gone(); settled.current?.(false); onBack(); });
      } else {
        go(0, s.vx, landed);
      }
    },
    onCancel: () => go(0, 0, landed),
  });

  const pageShown = Boolean(shownKey);
  return (
    <div className="mobile-nav relative h-full w-full overflow-hidden bg-app">
      <motion.div
        ref={baseRef}
        className="absolute inset-0"
        style={{ x: pageShown ? baseX : 0, willChange: moving ? "transform" : undefined }}
        inert={pageShown && !moving ? true : undefined}
        aria-hidden={pageShown && !moving ? true : undefined}
      >
        {base}
        {pageShown && <motion.div ref={dimRef} aria-hidden className="pointer-events-none absolute inset-0 bg-[rgb(10_10_12/0.16)]" style={{ opacity: dim }} />}
      </motion.div>
      {pageShown && (
        <motion.div
          ref={pageRef}
          key={shownKey}
          className="mobile-page absolute inset-0 bg-app"
          data-moving={moving ? "" : undefined}
          style={{ x, opacity: pageOpacity, willChange: moving ? "transform" : undefined }}
        >
          <TranscriptStaging value={staging}>{page ?? lastPage.current}</TranscriptStaging>
        </motion.div>
      )}
    </div>
  );
}
