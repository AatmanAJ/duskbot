import { useEffect, useRef, useSyncExternalStore } from "react";

// chromium runs a hidden window's timers up to a minute apart, so only a much longer gap is a sleep
export const LOOK_MS = 30_000;
export const ASLEEP_MS = 5 * 60_000;
export const FRESH_MS = 6 * 3_600_000;

export interface WorkingBot { botId: string; name: string }
export interface AsleepWork extends WorkingBot { wokeAt: number }
export interface Look { at: number; working: WorkingBot | null }

type BotFacts = { id: string; name: string; hidden?: boolean; tasks?: ReadonlyArray<{ busy?: boolean }> };

export function workingBot(bots: readonly BotFacts[]): WorkingBot | null {
  const busy = bots.filter((bot) => bot.tasks?.some((task) => task.busy));
  const bot = busy.find((candidate) => !candidate.hidden) ?? busy[0];
  return bot ? { botId: bot.id, name: bot.name } : null;
}

export function sleptOnWork(last: Look | null, now: number): AsleepWork | null {
  if (!last?.working || now - last.at < ASLEEP_MS) return null;
  return { ...last.working, wokeAt: now };
}

export const asleepFresh = (found: AsleepWork | null, now: number): AsleepWork | null =>
  found && now - found.wokeAt < FRESH_MS ? found : null;

let found: AsleepWork | null = null;
const listeners = new Set<() => void>();
const watch = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => found;

export function useAsleepWork(bots: readonly BotFacts[], on: boolean, now: () => number = Date.now): AsleepWork | null {
  const botsNow = useRef(bots), clock = useRef(now);
  botsNow.current = bots;
  clock.current = now;
  useEffect(() => {
    if (!on) return;
    let last: Look = { at: clock.current(), working: workingBot(botsNow.current) };
    const timer = setInterval(() => {
      const at = clock.current();
      const slept = sleptOnWork(last, at);
      if (slept) { found = slept; for (const listener of Array.from(listeners)) listener(); }
      last = { at, working: workingBot(botsNow.current) };
    }, LOOK_MS);
    return () => clearInterval(timer);
  }, [on]);
  return useSyncExternalStore(watch, read, () => null);
}

export function resetAsleepWork(): void {
  found = null;
}
