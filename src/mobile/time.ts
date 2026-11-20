import { activeLocale } from "@/lib/i18n";
import { deviceHourCycle } from "@/lib/format-time";

const DAY = 86_400_000;

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** A list row's time, as a messages app shows it: the clock today, "Yesterday", the weekday this week, else the date. */
export function listTime(at: number, now = Date.now()): string {
  const locale = activeLocale();
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hourCycle: deviceHourCycle() }).format(at);
  if (days === 1) return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
  if (days < 7) return new Intl.DateTimeFormat(locale, { weekday: "long" }).format(at);
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", ...(new Date(at).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) }).format(at);
}
