// What the island and the dock share: one motion language, the feed from main, the pointer test that decides where
// clicks land, and a bot's mark.
import { useEffect, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion, type MotionValue } from "motion/react";
import { MausAvatar, type MausAvatarHandle } from "@/components/Avatar";
import type { MarkReaction, MarkState } from "@/components/mascot-engine";
import type { BotBodyId } from "../../shared/bot-body";
import { isBusy } from "./mood";
import type { AmbientBot, AmbientBridge, AmbientSnapshot, AmbientStatus, AmbientStep, DockLayout, IslandLayout } from "./types";

/** Bencho's springs: settle for surfaces (no visible bounce), lively for small things that may overshoot. */
export const SETTLE = { type: "spring", stiffness: 380, damping: 34 } as const;
export const LIVELY = { type: "spring", stiffness: 500, damping: 18 } as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** Opacity runs on its own short clock, so a surface looks solid before it stops moving. */
export const FADE = { duration: 0.16, ease: EASE_OUT } as const;
export const FADE_OUT = { duration: 0.1, ease: EASE_OUT } as const;
/** Putting a surface away is quicker than bringing it out, and never lingers. */
export const EXIT = { duration: 0.14, ease: EASE_OUT } as const;
/** Surfaces fold away gently: a long, soft ease-out, after their words have begun to fade. */
export const SOFT_EASE = [0.25, 0.8, 0.25, 1] as const;
export const SOFT_EXIT = { duration: 0.34, ease: SOFT_EASE, delay: 0.06 } as const;
/** The island folds back in a balanced beat: smooth, never a snap, never dragging. */
export const ISLAND_EXIT = { duration: 0.42, ease: SOFT_EASE, delay: 0.04 } as const;

/** A number that moves to `target`: out on the settle spring, away on the quick exit clock. Retargets from wherever it
 * is, keeping its velocity. `out` says which way is out; by default growing is. */
export function useSurfaceValue(target: number, reduced: boolean, out?: boolean, away: { duration: number; ease: readonly [number, number, number, number]; delay?: number } = EXIT, trace?: (event: string, detail?: string) => void, toward: { type: "spring"; stiffness: number; damping: number; mass?: number } = SETTLE): MotionValue<number> {
  const value = useMotionValue(target);
  const traceNow = useRef(trace);
  traceNow.current = trace;
  useEffect(() => {
    if (reduced) { traceNow.current?.("motion-jump", `to ${Math.round(target)} (reduced motion)`); value.jump(target); return; }
    const outward = out ?? target >= value.get();
    const from = Math.round(value.get());
    if (from === Math.round(target)) return;
    const started = performance.now();
    traceNow.current?.("motion-start", `${from} -> ${Math.round(target)} ${outward ? "spring" : `${away.duration * 1000}ms`}`);
    const controls = animate(value, target, outward ? toward : { ...away, ease: [...away.ease] as [number, number, number, number] });
    void controls.then(() => traceNow.current?.("motion-end", `${Math.round(target)} after ${Math.round(performance.now() - started)}ms`), () => {});
    return () => controls.stop();
  }, [target, reduced, out, away, toward, value]);
  return value;
}

export function useAmbientFeed(bridge: AmbientBridge): { snapshot: AmbientSnapshot | null; layout: IslandLayout | DockLayout | null } {
  const [snapshot, setSnapshot] = useState<AmbientSnapshot | null>(null);
  const [layout, setLayout] = useState<IslandLayout | DockLayout | null>(null);
  useEffect(() => {
    const offState = bridge.onState(setSnapshot);
    const offLayout = bridge.onLayout(setLayout);
    bridge.ready();
    return () => { offState(); offLayout(); };
  }, [bridge]);
  return { snapshot, layout };
}

/** Whether the person is in another app or away (main's ambient-still.mjs): a surface then holds still. */
export function useStill(bridge: AmbientBridge): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => bridge.onStill?.((next) => setStill(next === true)), [bridge]);
  return still;
}

/** A change still shows for this long on a surface that is otherwise holding still. */
export const CHANGE_MOTION_MS = 3_000;

/** True for a moment after `key` changes, never for the first one: what was already so is not news. */
export function useChangeMoment(key: string, ms = CHANGE_MOTION_MS): boolean {
  const [moving, setMoving] = useState(false);
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    setMoving(true);
    const timer = setTimeout(() => setMoving(false), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return moving;
}

/**
 * The window lets clicks through except over the surface's shape: the page still hears the pointer move (main forwards
 * it), tests it against `hit`, and tells main when it crosses the edge. `onEnter`/`onLeave` fire on that crossing.
 * With `stage`, the point is measured from that element (scaled to its drawn size), for a surface shown inside a page.
 * With `solid`, only that (the shape as drawn) takes clicks: `hit` may reach past it so heading back never counts as
 * leaving, but a click on the empty grace around the shape still lands in the app underneath. A press held on the shape
 * keeps it solid until it is let go, so a drag never loses the pointer half way.
 */
export function usePointerRegion(bridge: AmbientBridge, hit: (x: number, y: number) => boolean, onEnter: () => void, onLeave: () => void, stage?: { ref: { current: HTMLElement | null }; width: number }, solid?: (x: number, y: number) => boolean) {
  const inside = useRef(false);
  const latest = useRef({ hit, onEnter, onLeave, stage, solid });
  latest.current = { hit, onEnter, onLeave, stage, solid };
  useEffect(() => {
    let solidNow = false;
    const take = (next: boolean) => {
      if (next === solidNow) return;
      solidNow = next;
      bridge.pointer(next);
    };
    const cross = (next: boolean, firm: boolean) => {
      take(next && firm);
      if (next === inside.current) return;
      inside.current = next;
      bridge.trace?.(next ? "pointer-enter" : "pointer-leave");
      if (next) latest.current.onEnter(); else latest.current.onLeave();
    };
    const at = (x: number, y: number, buttons: number) => {
      const { hit: test, solid: shape } = latest.current;
      const on = test(x, y);
      cross(on, on && (!shape || shape(x, y) || (solidNow && buttons !== 0)));
    };
    const move = (event: MouseEvent) => {
      const { stage: own } = latest.current;
      if (!own) return at(event.clientX, event.clientY, event.buttons);
      const rect = own.ref.current?.getBoundingClientRect();
      if (!rect?.width) return cross(false, false);
      const k = own.width / rect.width;
      at((event.clientX - rect.left) * k, (event.clientY - rect.top) * k, event.buttons);
    };
    const leave = () => cross(false, false);
    document.addEventListener("mousemove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      document.removeEventListener("mousemove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, [bridge]);
  return inside;
}

// poses that keep the bot's own body on screen: a dock or island mascot is how you tell who it is, so none of Grok's
// stand-ins (thinking dots, the search radar, the "!") that replace it
const MARK: Record<AmbientStatus, MarkState> = {
  idle: "idle",
  thinking: "computing",
  working: "working",
  talking: "streaming",
  "needs-you": "notifying",
  done: "happy",
  error: "failed",
};
/** What a running turn says it is doing, as such a pose. */
const STEP: Record<AmbientStep, MarkState> = {
  thinking: "computing", reply: "streaming", read: "reading", fetch: "reading", web: "reading", search: "reading",
  command: "running", write: "coding", edit: "coding", tool: "working",
};
export const markState = (status: AmbientStatus, step?: AmbientStep | null): MarkState => (isBusy(status) && step ? STEP[step] : MARK[status]);

/** A waiting bot waves at the person this often while someone can see it. */
export const WAVE_MS = 4200;
/** Cascading entrance: each mark starts this much after the one before it. */
const CASCADE_S = 0.03;
/** a long team still lands at once: the cascade stops growing after this many marks */
const CASCADE_CAP = 6;
const REACTION: Partial<Record<AmbientStatus, MarkReaction[]>> = { done: ["hop", "wiggle"], "needs-you": ["greet"], error: ["startle"] };

export interface BotMarkProps {
  bot: AmbientBot;
  size: number;
  state?: MarkState;
  /** Moving at all: false draws the rest pose (a surface holding still, or out of sight). */
  animated: boolean;
  /** Awake: blinks, glances and looks toward a pointer on it. */
  awake?: boolean;
  /** With `shown`, the mark pops in when shown, `index` places it in the cascade. */
  shown?: boolean;
  index?: number;
  /** Changes for a group moment (everything clear): every mark cheers, one after another. */
  cheer?: number;
  /** Moves played once for each new `key`, from the first one on (the island's wake: wake.ts MOMENT_POSE). */
  moment?: { key: string; reactions: readonly MarkReaction[] };
}

/** The bot's own mascot (or its picture), drawn still unless `animated`. Alive, it breathes on its own clock, reacts
 * when its state changes (a hop for a reply, a wave for an ask), waves again while it waits, and squashes under the
 * pointer. Transform and opacity only. */
export function BotMark({ bot, size, state, animated, awake = false, shown, index = 0, cheer = 0, moment }: BotMarkProps) {
  const reduced = useReducedMotion() === true;
  const mark = useRef<MausAvatarHandle>(null);
  const alive = animated && !reduced;
  const react = (kind: MarkReaction, delay = 0) => { const timer = setTimeout(() => mark.current?.react?.(kind), delay); return () => clearTimeout(timer); };
  const lastStatus = useRef(bot.status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = bot.status;
    if (was === bot.status || !alive) return;
    const [first, second] = REACTION[bot.status] ?? [];
    if (!first) return;
    const undo = [react(first, 60), second ? react(second, 700) : () => {}];
    return () => { for (const off of undo) off(); };
  }, [bot.status, alive]);
  useEffect(() => {
    if (!alive || bot.status !== "needs-you") return;
    const timer = setInterval(() => mark.current?.react?.(index % 2 ? "hop" : "greet"), WAVE_MS + (index % 3) * 400);
    return () => clearInterval(timer);
  }, [alive, bot.status, index]);
  const played = useRef("");
  const momentKey = moment?.key ?? "";
  const momentMoves = moment?.reactions.join(",") ?? "";
  useEffect(() => {
    if (!momentKey || played.current === momentKey || !alive) return;
    played.current = momentKey;
    const moves = momentMoves.split(",").filter(Boolean) as MarkReaction[];
    const timers = moves.map((kind, step) => setTimeout(() => mark.current?.react?.(kind), 220 + step * 640));
    const started = Date.now(), last = 220 + (moves.length - 1) * 640;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      // cut short before it played (a remount, or the mark held still): it plays the next time it can
      if (Date.now() - started < last) played.current = "";
    };
  }, [momentKey, momentMoves, alive]);
  const lastCheer = useRef(cheer);
  useEffect(() => {
    if (lastCheer.current === cheer) return;
    lastCheer.current = cheer;
    if (alive) return react("cheer", 80 + index * 70);
  }, [cheer, alive, index]);

  const face = bot.avatar
    ? <img className="amb-photo" src={bot.avatar} alt="" width={size} height={size} draggable={false} style={{ borderRadius: Math.round(size * 0.3) }} />
    : (
      <MausAvatar
        ref={mark}
        color={bot.color}
        bodyId={(bot.body ?? undefined) as BotBodyId | undefined}
        faceColor={bot.face}
        size={size}
        state={state ?? markState(bot.status, bot.step)}
        animated={animated}
        trackPointer={animated && awake}
        personality={animated && awake}
        cueKey={bot.id}
      />
    );
  const visible = shown ?? true;
  return (
    <motion.span
      className="amb-live"
      initial={false}
      animate={visible ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: reduced ? 1 : 0.6, y: reduced ? 0 : 6 }}
      transition={visible ? { opacity: { ...FADE, delay: Math.min(index, CASCADE_CAP) * CASCADE_S }, scale: { ...LIVELY, delay: Math.min(index, CASCADE_CAP) * CASCADE_S }, y: { ...LIVELY, delay: Math.min(index, CASCADE_CAP) * CASCADE_S } } : { duration: 0 }}
      whileHover={alive ? { scaleX: 1.08, scaleY: 0.93, transition: LIVELY } : undefined}
    >
      <span className="amb-breathe" data-on={alive || undefined} style={{ animationDelay: `${-(seedOf(bot.id) % 3200)}ms` }}>{face}</span>
    </motion.span>
  );
}

const seedOf = (text: string) => [...text].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** Everything answered or seen and nobody busy, just now: `smiling` for `ms`, and `cheer` counts each such moment. */
export function useAllClear(busyOrNews: boolean, ms: number): { smiling: boolean; cheer: number } {
  const [smiling, setSmiling] = useState(false);
  const [cheer, setCheer] = useState(0);
  const had = useRef(busyOrNews);
  useEffect(() => {
    const was = had.current;
    had.current = busyOrNews;
    if (busyOrNews) { setSmiling(false); return; }
    if (!was) return;
    setSmiling(true);
    setCheer((count) => count + 1);
    const timer = setTimeout(() => setSmiling(false), ms);
    return () => clearTimeout(timer);
  }, [busyOrNews, ms]);
  return { smiling, cheer };
}

/** A value change has to hold this long before a surface shows it: sub-second states never flap the island. */
export const SETTLE_MS = 600;
/** Once the island shows a bot, it keeps it at least this long before showing another. */
export const HOLD_MS = 4000;

/** `key` once it has held for `settle` ms, and once shown, kept at least `hold` ms before the next. Changes inside that
 * time coalesce into one. */
export function useSteady(key: string, settle = SETTLE_MS, hold = 0): string {
  const [shown, setShown] = useState(key);
  const shownAt = useRef(0);
  const latest = useRef(key);
  latest.current = key;
  useEffect(() => {
    if (key === shown) return;
    const wait = Math.max(settle, hold - (Date.now() - shownAt.current));
    const timer = setTimeout(() => { shownAt.current = Date.now(); setShown(latest.current); }, wait);
    return () => clearTimeout(timer);
  }, [key, shown, settle, hold]);
  return shown;
}

/** While tracing, every CSS transition on the surface, as it starts and ends (which element, which property). */
export function useTraceTransitions(bridge: AmbientBridge) {
  useEffect(() => {
    const trace = bridge.trace;
    if (!trace) return;
    const name = (target: EventTarget | null) => {
      const node = target as HTMLElement | null;
      return node?.className && typeof node.className === "string" ? node.className.split(" ").filter(Boolean).slice(0, 2).join(".") : node?.tagName?.toLowerCase() ?? "?";
    };
    const on = (event: Event) => { const transition = event as TransitionEvent; trace(`css-${event.type.replace("transition", "")}`, `${name(event.target)} ${transition.propertyName}`); };
    for (const type of ["transitionstart", "transitionend", "transitioncancel"]) document.addEventListener(type, on, true);
    trace("page-ready", `reduced-motion=${matchMedia("(prefers-reduced-motion: reduce)").matches} visible=${document.visibilityState}`);
    return () => { for (const type of ["transitionstart", "transitionend", "transitioncancel"]) document.removeEventListener(type, on, true); };
  }, [bridge]);
}

/** A surface's closing has played out by then: the leave delay is behind it, its words and its shell are gone. */
export const SETTLED_MS = 480;

/** Tells main once the surface has finished closing (ambient-window.mjs waits for it before giving the keyboard back,
 * which on macOS reorders the panel and would cut the animation short). */
export function useSettledSignal(bridge: AmbientBridge, shown: boolean) {
  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => { bridge.trace?.("settled-signal"); bridge.settled?.(); }, SETTLED_MS);
    return () => clearTimeout(timer);
  }, [bridge, shown]);
}

/** A clock for "4m" that only ticks while someone can see it. */
export function useNow(active: boolean, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}
