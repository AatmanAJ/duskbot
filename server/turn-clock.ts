// The time rides each turn's text, never the system prompt (whose stable half must stay byte-identical); engines add the date at most.
import { plainTimeZone } from "../shared/plain-time-zone.ts";

export function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const parts = (at: number, timeZone: string) => {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => formatted.find((entry) => entry.type === type)?.value ?? "";
  return { part, timeZone };
};

export const TURN_CLOCK_LEAD = "Current time when this message was sent: ";

export function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export function personTimeZone(told: string | undefined): string {
  return told || hostTimeZone();
}

export const MID_CHAT_NOTE = " Mid-conversation: do not greet by time of day.";

/** `greeting` false: mid-conversation, so the line names no part of the day a model would answer with "good afternoon". */
export function turnClockLine(at: number, timeZone: string, greeting = true): string {
  let read: ReturnType<typeof parts>;
  try {
    read = parts(at, timeZone);
  } catch {
    read = parts(at, "UTC");
  }
  const { part } = read;
  // longOffset spells UTC as a bare "GMT", and some ICU builds write the minus sign as U+2212.
  const offset = part("timeZoneName").replace(/^GMT/, "").replace("\u2212", "-") || "+00:00";
  const plain = plainTimeZone(read.timeZone);
  const day = greeting ? `${part("weekday")} ${partOfDay(Number(part("hour")))}` : part("weekday");
  return `${TURN_CLOCK_LEAD}${day}, ${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${read.timeZone} (${plain === read.timeZone ? "" : `${plain}, `}UTC${offset}).${greeting ? "" : MID_CHAT_NOTE}`;
}

/** Not for an empty text or a slash command: a prefix would turn an engine's own command into prose. */
export function takesTurnClock(text: string): boolean {
  return Boolean(text.trim()) && !text.trimStart().startsWith("/");
}

export function withTurnClock(clock: string, text: string): string {
  if (!clock || !takesTurnClock(text)) return text;
  return `${clock}\n\n${text}`;
}
