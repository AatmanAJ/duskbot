// flows kit: a script runner that autoplays a flow and hands over on the first click, and the small moving parts the
// variants share (text swap, digit roll, drawn check, arc spinner). the lab's clock already slows motion and css, so
// only our own timers go through ms().
import { AnimatePresence, motion, useSpring, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ease, ms, offset, reducedFade, spring } from "@lab/tokens";

type Next<S> = S | ((now: S) => S);
type Step<S> = readonly [number, Next<S>];

/**
 * one flow's state: on every replay it starts over and plays `script` (each step waits its ms). the first thing the
 * person does takes over: the script stops and their click moves the flow; `later` schedules a fake wait after it.
 */
export function useFlow<S>(initial: S, replayKey: number, speed: number, script: readonly Step<S>[]) {
  const [state, setState] = useState<S>(initial);
  const [auto, setAuto] = useState(true);
  const timers = useRef<number[]>([]);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const initialRef = useRef(initial);
  const clear = () => { for (const timer of timers.current) clearTimeout(timer); timers.current = []; };
  const play = useCallback(() => {
    clear();
    setState(initialRef.current);
    setAuto(true);
    let at = 0;
    for (const [wait, next] of scriptRef.current) {
      at += ms(wait, speedRef.current);
      timers.current.push(window.setTimeout(() => setState(next as Next<S>), at));
    }
  }, []);
  useEffect(() => { play(); return clear; }, [replayKey, play]);
  const go = useCallback((next: Next<S>) => { clear(); setAuto(false); setState(next); }, []);
  const later = useCallback((wait: number, next: Next<S>) => {
    timers.current.push(window.setTimeout(() => setState(next), ms(wait, speedRef.current)));
  }, []);
  /** a person's move followed by its fake waits, each relative to the one before */
  const run = useCallback((first: Next<S>, steps: readonly Step<S>[]) => {
    clear(); setAuto(false); setState(first);
    let at = 0;
    for (const [wait, next] of steps) {
      at += ms(wait, speedRef.current);
      timers.current.push(window.setTimeout(() => setState(next as Next<S>), at));
    }
  }, []);
  return { state, go, later, run, set: setState, auto, replay: play };
}

/** the app canvas for one column, filling the stage */
export function Canvas({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative flex h-full w-full flex-col overflow-hidden bg-app text-ink", className)}>{children}</div>;
}

/** a quiet way to run a finished flow again, bottom right */
export function Again({ show, onClick }: { show: boolean; onClick: () => void }) {
  return <AnimatePresence>
    {show && <motion.button type="button" onClick={onClick} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute bottom-2 end-2 z-30 min-h-8 rounded-full px-3 text-[12px] text-ink-tertiary transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
      Play again
    </motion.button>}
  </AnimatePresence>;
}

/** text or an icon that swaps: the new one rises 8px out of a 4px blur, the old leaves up 6px in 120ms */
export function Swap({ id, children, reduced, className, rise = offset.swapIn }: { id: string | number; children: ReactNode; reduced: boolean;
  className?: string; rise?: number }) {
  return <span className={cn("relative inline-grid", className)}>
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={id} className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: rise, filter: `blur(${offset.blurIn}px)` }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={reduced ? { opacity: 0, transition: reducedFade } : { opacity: 0, y: offset.swapOut, filter: `blur(${offset.blurOut}px)`, transition: { duration: 0.12, ease: ease.out } }}
        transition={reduced ? reducedFade : spring.fade}>
        {children}
      </motion.span>
    </AnimatePresence>
  </span>;
}

/** one digit as a drum: 0-9 stacked and moved to the digit, faded at its top and bottom edges */
function Drum({ digit, reduced, index, stagger }: { digit: number; reduced: boolean; index: number; stagger: number }) {
  // the invisible digit gives the drum a text baseline, so it lines up with the words around it
  return <span className="relative inline-block h-[1.25em] leading-[1.25em] [clip-path:inset(0)] [mask-image:linear-gradient(transparent,#000_14%,#000_86%,transparent)]">
    <span className="invisible">0</span>
    <motion.span className="absolute inset-x-0 top-0 flex flex-col items-center"
      initial={false} animate={{ y: `${-digit * 1.25}em` }}
      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 22 + 2 * index, delay: index * stagger }}>
      {Array.from({ length: 10 }, (_, n) => <span key={n} className="block h-[1.25em] leading-[1.25em]">{n}</span>)}
    </motion.span>
  </span>;
}

/**
 * a number that rolls only the digits that change: each digit is a drum on 260/(22+2i), `stagger` apart from the left;
 * $ and . sit still. keyed from the right, so $15 -> $49 rolls two drums and a new leading digit fades in.
 * the drum idea is DesignBookmark's plan switch (look only, rebuilt here).
 */
export function Roll({ value, reduced, stagger = 0.045, className }: { value: string; reduced: boolean; stagger?: number; className?: string }) {
  const chars = [...value];
  return <span className={cn("inline-flex tabular-nums", className)}>
    <span className="sr-only">{value}</span>
    <span aria-hidden="true" className="inline-flex items-baseline">
      {chars.map((char, i) => {
        const key = `${chars.length - i}`;
        return /\d/.test(char)
          ? <Drum key={key} digit={Number(char)} reduced={reduced} index={i} stagger={stagger} />
          : <span key={key + char}>{char}</span>;
      })}
    </span>
  </span>;
}

/** a check that draws itself after `delay` over `draw` seconds (ease in-out); whole and only fading under reduced motion */
export function DrawCheck({ size = 14, reduced, delay = 0.15, draw = 0.3, className, strokeWidth = 2.6 }: { size?: number; reduced: boolean;
  delay?: number; draw?: number; className?: string; strokeWidth?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("shrink-0", className)}>
    <motion.path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      initial={reduced ? { pathLength: 1, opacity: 0 } : { pathLength: 0, opacity: 1 }} animate={{ pathLength: 1, opacity: 1 }}
      transition={reduced ? reducedFade : { duration: draw, ease: ease.inOut, delay }} />
  </svg>;
}

/** an arc that turns at ~1.3 turns/s; under reduced motion it holds still and breathes its opacity */
export function Arc({ size = 14, reduced, className }: { size?: number; reduced: boolean; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
    className={cn("shrink-0", reduced ? "flows-breathe" : "flows-turn", className)}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.6" />
    <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
  </svg>;
}


/**
 * a highlight whose two edges move on different springs: the edge facing the move is stiff (lead 620/36), the other
 * catches up (trail 190/19), so it stretches toward where it goes. rebuilt from DesignBookmark's two-edge highlight (look only).
 */
export function Stretch({ left, right, reduced, className, vertical = false }: { left: number; right: number; reduced: boolean; className?: string; vertical?: boolean }) {
  const prev = useRef({ left, right });
  const forward = left >= prev.current.left;
  prev.current = { left, right };
  const lead = { stiffness: spring.lead.stiffness, damping: spring.lead.damping };
  const trail = { stiffness: spring.trail.stiffness, damping: spring.trail.damping };
  const still = { stiffness: 5000, damping: 200 };
  const start = useSpring(left, reduced ? still : forward ? trail : lead);
  const end = useSpring(right, reduced ? still : forward ? lead : trail);
  useEffect(() => { start.set(left); end.set(right); }, [left, right, start, end]);
  const size = useTransform(() => Math.max(0, end.get() - start.get()));
  return <motion.span aria-hidden="true" className={cn("absolute", className)}
    style={vertical ? { top: start, height: size } : { left: start, width: size }} />;
}
