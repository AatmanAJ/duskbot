import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { animate, useMotionValue, useTransform } from "motion/react";
import { ms, spring } from "@lab/tokens";
import { cn } from "@/lib/cn";

// shared bits for the composer and pickers section. motion and css are slowed by the lab clock; only the timers here
// go through ms(value, speed).

/** a scripted autoplay: runs `steps` (delay in ms at 1x, then the action) on mount and on every replay; any real input
 * from the person calls `stop()` so the script never fights them. */
export function useScript(replayKey: number, speed: number, steps: Array<[number, () => void]>, reset?: () => void) {
  const timers = useRef<number[]>([]);
  const stop = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };
  const run = useRef(steps);
  run.current = steps;
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    resetRef.current?.();
    let at = 0;
    for (const [delay, action] of run.current) {
      at += delay;
      timers.current.push(window.setTimeout(action, ms(at, speed)));
    }
    return stop;
    // speed is read once per run; a speed change takes effect on the next replay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey]);
  return stop;
}

/** a timer that respects the lab's speed and clears itself */
export function useLater(speed: number) {
  const timers = useRef<Set<number>>(new Set());
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  return (value: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms(value, speed));
    timers.current.add(timer);
    return () => {
      window.clearTimeout(timer);
      timers.current.delete(timer);
    };
  };
}

/** an element's content height, measured in the frame it changes */
export function useContentHeight(ref: RefObject<HTMLElement | null>, extra = 0): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(Math.ceil(el.offsetHeight + extra));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, extra]);
  return height;
}

/** the stage ground: content pinned to the bottom like the composer dock, or centred */
export function Stage({ children, align = "end", className }: { children: ReactNode; align?: "end" | "center" | "start"; className?: string }) {
  return (
    <div className={cn("flex h-full w-full flex-col px-4 py-4", align === "end" ? "justify-end" : align === "center" ? "justify-center" : "justify-start", className)}>
      {children}
    </div>
  );
}

/** a quiet one-line hint under a demo, telling the reviewer what to try */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="pointer-events-none absolute inset-x-0 top-2.5 text-center text-[11px] leading-4 text-ink-tertiary">{children}</p>;
}

// the composer's round button wears the bot's colour; the lab uses dusk bot's green bot on the grok skins
export const SLOT = { fill: "#1f9d55", ink: "#ffffff" } as const;

/** Simple mode's composer pill, from components/composer-simple.ts (minus the transitions, which each column owns) */
export const PILL =
  "relative flex flex-col justify-end bg-composer px-[9px] pt-[7px] pb-[9px] inset-ring-[0.5px] inset-ring-ink/[0.12] hover:inset-ring-ink/[0.24] focus-within:inset-ring-ink/[0.24] shadow-[0_2px_8px_-1px_rgb(0_0_0/0.05),0_1px_2px_rgb(0_0_0/0.03),0_0_0_1px_rgb(228_228_228/0.04)]";

/** the small round controls: +, the mic beside Send, Stop beside */
export const CONTROL =
  "flex size-7 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] inset-ring-[0.5px] inset-ring-ink/[0.08] text-ink/[0.56] hover:bg-ink/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** the field: 14/20 text, placeholder at 40% ink */
export const FIELD =
  "block max-h-[9rem] w-full resize-none overflow-y-auto bg-transparent text-[14px] leading-5 tracking-[0.01em] text-ink placeholder:text-ink/40 focus:outline-none";

/** focus ring used across the section's own controls */
export const RING = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus";

/** the field wraps when the text has a newline or overflows one line; it stays stacked until it empties (grok's hold) */
export function useStacked(input: RefObject<HTMLTextAreaElement | null>, text: string): boolean {
  const [wrapAt, setWrapAt] = useState<number | null>(null);
  const stacked = text.includes("\n") || (wrapAt !== null && text.length >= wrapAt) || (wrapAt !== null && text.length > 0);
  useLayoutEffect(() => {
    if (!text) {
      setWrapAt(null);
      return;
    }
    const el = input.current;
    if (!el || stacked) return;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    if (el.scrollHeight > line * 1.5) setWrapAt(text.length);
  }, [input, text, stacked]);
  return stacked;
}

/** a textarea that sizes to its text (rows grow until max-h, then it scrolls) */
export function useAutoRows(input: RefObject<HTMLTextAreaElement | null>, text: string, stacked: boolean) {
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [input, text, stacked]);
}

export const LONG_TEXT = "Plan my week around the launch:\nmove the 1:1s to Thursday and draft the update for Friday";

/** a highlight that stretches between two edges: the edge facing the move is stiff (lead), the other catches up (trail) */
export function useStretch(target: { start: number; end: number } | null, instant = false) {
  const start = useMotionValue(target?.start ?? 0);
  const end = useMotionValue(target?.end ?? 0);
  const placed = useRef(false);
  useLayoutEffect(() => {
    if (!target) return;
    if (!placed.current || instant) {
      placed.current = true;
      start.set(target.start);
      end.set(target.end);
      return;
    }
    const forward = target.start > start.get();
    const a = animate(start, target.start, forward ? spring.trail : spring.lead);
    const b = animate(end, target.end, forward ? spring.lead : spring.trail);
    return () => { a.stop(); b.stop(); };
  }, [target?.start, target?.end, instant, start, end]);
  return { start, end, size: useTransform(() => end.get() - start.get()) };
}
