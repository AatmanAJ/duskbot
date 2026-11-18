import type { WireMessage } from "../shared/wire.ts";
import { turnClockLine } from "./turn-clock.ts";

export const QUIET_GAP_MS = 6 * 60 * 60_000;
export const GREETING_GAP_MS = 4 * 60 * 60_000;

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export function previousPersonMessageAt(messages: ReadonlyArray<Pick<WireMessage, "id" | "role" | "kind" | "at">>, currentId: string): number | null {
  let latest: number | null = null;
  for (const message of messages) {
    if (message.id === currentId || message.role !== "user" || message.kind !== "text") continue;
    if (Number.isFinite(message.at) && (latest === null || message.at > latest)) latest = message.at;
  }
  return latest;
}

export function gapWords(ms: number): string {
  const unit = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (ms < DAY) return unit(Math.max(1, Math.floor(ms / HOUR)), "hour");
  if (ms < 14 * DAY) return unit(Math.floor(ms / DAY), "day");
  if (ms < 60 * DAY) return unit(Math.floor(ms / (7 * DAY)), "week");
  return unit(Math.floor(ms / (30 * DAY)), "month");
}

export function quietGapNote(previousAt: number | null, now: number): string {
  if (previousAt === null || !Number.isFinite(previousAt)) return "";
  const gap = now - previousAt;
  if (gap < QUIET_GAP_MS) return "";
  return ` The person's previous message in this chat was ${gapWords(gap)} ago: what was said here about prices, plans, times or "later today" may be out of date, so check before relying on it, and do not pick up as if no time had passed.`;
}

/** A time-of-day greeting fits the first message of a chat or one after a long quiet, never the middle of a conversation. */
export function greetingFits(previousAt: number | null, now: number): boolean {
  return previousAt === null || !Number.isFinite(previousAt) || now - previousAt >= GREETING_GAP_MS;
}

/** The clock for a person's turn; `previousAt` undefined is a turn that is not a fresh message from them (a bot hop, a continuation). */
export function personClock(now: number, timeZone: string, previousAt: number | null | undefined): string {
  if (previousAt === undefined) return turnClockLine(now, timeZone, false);
  return turnClockLine(now, timeZone, greetingFits(previousAt, now)) + quietGapNote(previousAt, now);
}
