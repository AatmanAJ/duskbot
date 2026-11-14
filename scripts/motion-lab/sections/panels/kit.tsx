// shared bits for the panels and ambient section: fake bots, replay scripts, keyboard intent and the two-edge
// stretch highlight. lives under this section only (the shell and lib/ belong to the harness).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { LabProps } from "@lab/types";
import { animate, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { MausAvatar } from "@/components/Avatar";
import type { MausColor } from "@/lib/mascot";
import { ms, spring } from "@lab/tokens";

export type LabBot = { id: string; name: string; color: MausColor; preview: string; title: string };

export const BOTS: LabBot[] = [
  { id: "nova", name: "Nova", color: "blue", title: "Travel", preview: "Found 3 direct flights to Lisbon" },
  { id: "quill", name: "Quill", color: "purple", title: "Writer", preview: "The launch post draft is ready" },
  { id: "juno", name: "Juno", color: "pink", title: "Errands", preview: "Booked the 18:10 home on Sunday" },
  { id: "rivet", name: "Rivet", color: "orange", title: "Web", preview: "The footer fix is deployed" },
  { id: "tally", name: "Tally", color: "green", title: "Money", preview: "October is 4% under budget" },
];

export function Mascot({ color, size = 36 }: { color: MausColor; size?: number }) {
  return <MausAvatar color={color} size={size} animated={false} />;
}

/** Runs `steps` (ms at 1x, action) on mount and again on every replay, at the lab's speed. */
export function useScript(replayKey: number, speed: number, steps: Array<[number, () => void]>, reset?: () => void) {
  const latest = useRef({ steps, reset });
  latest.current = { steps, reset };
  useEffect(() => {
    latest.current.reset?.();
    const timers = latest.current.steps.map(([at, run]) => window.setTimeout(() => run(), ms(at, speed)));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [replayKey, speed]);
}

/** True while the last input inside `root` was a key press: keyboard moves jump, pointer moves glide. */
export function useKeyboardIntent(root: RefObject<HTMLElement | null>): RefObject<boolean> {
  const keyboard = useRef(false);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const key = () => { keyboard.current = true; };
    const point = () => { keyboard.current = false; };
    node.addEventListener("keydown", key, true);
    node.addEventListener("pointerdown", point, true);
    return () => { node.removeEventListener("keydown", key, true); node.removeEventListener("pointerdown", point, true); };
  }, [root]);
  return keyboard;
}

/** The two-edge stretch: the edge facing the move runs on spring.lead, the other catches up on spring.trail, so the
 * highlight stretches toward where it is going and lands without overshoot. `instant` (keyboard, reduced) jumps. */
export function useStretch(start: number, end: number, instant: boolean): { start: MotionValue<number>; size: MotionValue<number> } {
  const a = useMotionValue(start);
  const b = useMotionValue(end);
  const first = useRef(true);
  useEffect(() => {
    if (first.current || instant) { first.current = false; a.jump(start); b.jump(end); return; }
    const forward = start > a.get();
    animate(a, start, forward ? spring.trail : spring.lead);
    animate(b, end, forward ? spring.lead : spring.trail);
  }, [start, end, instant, a, b]);
  useEffect(() => () => { a.stop(); b.stop(); }, [a, b]);
  const size = useTransform(() => Math.max(0, b.get() - a.get()));
  return { start: a, size };
}

/** An element's offset box inside its offset parent, measured before paint and on resize. */
export function useBox(ref: RefObject<HTMLElement | null>, deps: unknown[]): { x: number; y: number; w: number; h: number } {
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setBox((was) => {
      const next = { x: node.offsetLeft, y: node.offsetTop, w: node.offsetWidth, h: node.offsetHeight };
      return was.x === next.x && was.y === next.y && was.w === next.w && was.h === next.h ? was : next;
    });
    read();
    const watch = new ResizeObserver(read);
    watch.observe(node);
    if (node.parentElement) watch.observe(node.parentElement);
    return () => watch.disconnect();
  }, deps);
  return box;
}

/** A stage's own width, for things drawn at a fixed size and scaled to fit. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setWidth(node.clientWidth);
    read();
    const watch = new ResizeObserver(read);
    watch.observe(node);
    return () => watch.disconnect();
  }, [ref]);
  return width;
}

/** A small lab control under a stage: a quiet pill button. */
export const labBtn = "dusk-press inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-ink/[0.06] px-3 text-[12px] leading-4 text-ink hover:bg-ink/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-40";

export type Mode = "original" | "a" | "b";

/** One view drawn three ways: Original, A and B. */
export function columns(View: (props: LabProps & { mode: Mode }) => ReactNode) {
  return {
    Original: (props: LabProps) => <View {...props} mode="original" />,
    A: (props: LabProps) => <View {...props} mode="a" />,
    B: (props: LabProps) => <View {...props} mode="b" />,
  };
}
