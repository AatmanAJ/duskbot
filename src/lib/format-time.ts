import { activeLocale } from "@/lib/i18n";

const DEVICE_CLOCK = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** The device's own 12 or 24 hour clock, which every time in the app follows whatever language it is written in. */
export function deviceHourCycle(): Intl.DateTimeFormatOptions["hourCycle"] {
  return DEVICE_CLOCK.resolvedOptions().hourCycle;
}

let clock: { locale: string; format: Intl.DateTimeFormat } | null = null;

/** A time of day, "22:43" or "10:43 PM": the app's language on the device's clock. */
export function formatTime(at: number) {
  const date = new Date(at);
  // toLocaleTimeString's output, where Intl.DateTimeFormat.format would throw
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  const locale = activeLocale();
  if (clock?.locale !== locale) clock = { locale, format: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hourCycle: deviceHourCycle() }) };
  return clock.format.format(date);
}
