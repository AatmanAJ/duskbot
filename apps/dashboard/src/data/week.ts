import type { BotRow } from "./usage.ts";
import type { UsageSource } from "./usage-math.ts";
import { dayKey } from "../lib/format.ts";

const WEEKDAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export interface WeekDay { key: string; label: string; date: number; turns: number; today: boolean }

export interface HomeStats {
  days: WeekDay[];
  turns: number;
  bots: number;
  working: number;
  routines: number;
  pausedRoutines: number;
  apps: number;
}

/** the home page's numbers, summed over every workspace; all zero for a new account, never made up */
export function homeStats(sources: UsageSource[], bots: BotRow[], connections: Record<string, string[]> | null, now: number): HomeStats {
  const byDay = new Map<string, number>();
  for (const source of sources) for (const day of source.activity?.days ?? []) byDay.set(day.date, (byDay.get(day.date) ?? 0) + day.turns);
  const today = new Date(now);
  const days: WeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12);
    const key = dayKey(d);
    days.push({ key, label: WEEKDAY[d.getDay()]!, date: d.getTime(), turns: byDay.get(key) ?? 0, today: i === 0 });
  }
  const routines = bots.flatMap((row) => row.bot.routines ?? []);
  const apps = new Set(Object.values(connections ?? {}).flat().map((slug) => slug.toLowerCase()));
  return {
    days,
    turns: days.reduce((sum, day) => sum + day.turns, 0),
    bots: bots.length,
    working: bots.filter((row) => row.mood === "working").length,
    routines: routines.length,
    pausedRoutines: routines.filter((routine) => routine.paused).length,
    apps: apps.size,
  };
}
