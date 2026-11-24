// A person's world: who they are and what their connected apps and home folder hold. Times in seeds are written
// relative to the moment the first session starts, in the person's own time zone: "@-1d 14:20" (yesterday 14:20),
// "@+2d 09:00", "@-3h", "@+45m", "@0d 18:00". Anything else is kept as written.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let contentDir = dirname(fileURLToPath(import.meta.url));
/** Where worlds/ and scenarios/ live: this folder unless a run points elsewhere. */
export const setContentDir = (dir: string) => { contentDir = dir; };
export const getContentDir = () => contentDir;

export const APPS = ["gmail", "google_calendar", "slack", "github", "notes", "shop", "crm"] as const;
export type App = typeof APPS[number];

export interface Persona {
  id: string;
  name: string;
  email: string;
  tz: string;
  /** who they are, for the simulated person only */
  about: string;
  /** how they type */
  style: string;
  /** what they wrote in Settings → About me, or empty */
  aboutMe?: string;
}

export interface World {
  persona: Persona;
  /** the main bot's name */
  botName: string;
  apps: App[];
  /** weekday and local time the first session starts, e.g. "mon 08:40" */
  start: string;
  profile: { name: string; email: string; aliases?: string[]; slack?: string; github?: string };
  mail?: unknown[];
  events?: unknown[];
  slack?: { channels: Record<string, { topic?: string; members?: string[]; messages: unknown[] }> };
  github?: { repos: unknown[] };
  notes?: unknown[];
  shop?: { orders?: unknown[]; products?: unknown[]; customers?: unknown[] };
  crm?: { contacts?: unknown[]; deals?: unknown[] };
  /** files in the person's home folder, path relative to home → text */
  files?: Record<string, string>;
}

export function loadWorld(id: string): World {
  return JSON.parse(readFileSync(join(contentDir, "worlds", `${id}.json`), "utf8")) as World;
}

export function worldIds(): string[] {
  const dir = join(contentDir, "worlds");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
}

/** Offset in ms of `tz` from UTC at `epoch`. */
function zoneOffset(epoch: number, tz: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(epoch)).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - Math.floor(epoch / 1000) * 1000;
}

/** Epoch of local wall time y-m-d h:m in `tz`. */
export function zoned(tz: string, y: number, m: number, d: number, hh: number, mm: number): number {
  const guess = Date.UTC(y, m, d, hh, mm);
  const first = guess - zoneOffset(guess, tz);
  return guess - zoneOffset(first, tz);
}

/** The local calendar date of `epoch` in `tz`. */
export function localDate(epoch: number, tz: string): { y: number; m: number; d: number; weekday: number } {
  const local = new Date(epoch + zoneOffset(epoch, tz));
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate(), weekday: local.getUTCDay() };
}

/** ISO time with the zone's own offset, as calendar and mail APIs show it. */
export function isoIn(epoch: number, tz: string): string {
  const off = zoneOffset(epoch, tz);
  const local = new Date(epoch + off).toISOString().slice(0, 19);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off) / 60_000;
  return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** The first moment of the simulation: the next given weekday (never today) at the given local time. */
export function startEpoch(start: string, tz: string, realNow = Date.now()): number {
  const [day, time] = start.trim().toLowerCase().split(/\s+/);
  const [hh, mm] = (time ?? "09:00").split(":").map(Number);
  const want = DAYS.indexOf(day!.slice(0, 3));
  if (want < 0) throw new Error(`bad start ${start}`);
  const today = localDate(realNow, tz);
  for (let i = 1; i <= 7; i++) {
    const probe = localDate(zoned(tz, today.y, today.m, today.d + i, 12, 0), tz);
    if (probe.weekday === want) return zoned(tz, probe.y, probe.m, probe.d, hh!, mm!);
  }
  throw new Error("unreachable");
}

const REL = /^@([+-]?\d+)([dhm])(?:\s+(\d{1,2}):(\d{2}))?$/;

/** "@-1d 14:20" etc. against `base` (an epoch) in `tz`; returns epoch or null when `text` is not relative. */
export function relEpoch(text: string, base: number, tz: string): number | null {
  const m = REL.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "h") return base + n * 3_600_000;
  if (m[2] === "m") return base + n * 60_000;
  const day = localDate(base, tz);
  if (m[3] === undefined) {
    const local = new Date(base + zoneOffset(base, tz));
    return zoned(tz, day.y, day.m, day.d + n, local.getUTCHours(), local.getUTCMinutes());
  }
  return zoned(tz, day.y, day.m, day.d + n, Number(m[3]), Number(m[4]));
}

/** Every "@…" string anywhere in `value` becomes an ISO time in the person's zone. */
export function resolveTimes<T>(value: T, base: number, tz: string): T {
  if (typeof value === "string") { const at = relEpoch(value, base, tz); return (at === null ? value : isoIn(at, tz)) as T; }
  if (Array.isArray(value)) return value.map((v) => resolveTimes(v, base, tz)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTimes(v, base, tz)])) as T;
  return value;
}

/** Arrays append, objects merge, anything else replaces. */
export function deepMerge<T>(base: T, extra: unknown): T {
  if (Array.isArray(base) && Array.isArray(extra)) return [...base, ...extra] as T;
  if (base && extra && typeof base === "object" && typeof extra === "object" && !Array.isArray(base)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) out[k] = k in out ? deepMerge(out[k], v) : v;
    return out as T;
  }
  return (extra === undefined ? base : extra) as T;
}

/** The connectors' state file: the person's profile plus every app's data, with ids filled in. */
export function connectorState(world: World, base: number): Record<string, unknown> {
  const w = resolveTimes(world, base, world.persona.tz);
  const fill = <T extends Record<string, unknown>>(rows: unknown[] | undefined, prefix: string) => (rows ?? []).map((row, i) => ({ id: `${prefix}${i + 1}`, ...(row as T) }));
  const mail = fill(w.mail, "m").map((m: any) => ({ to: w.profile.email, labels: ["INBOX"], read: false, ...m }));
  const slack = { channels: Object.fromEntries(Object.entries(w.slack?.channels ?? {}).map(([name, c]) => [name, { topic: c.topic ?? "", members: c.members ?? [], messages: (c.messages as any[]).map((m, i) => ({ ts: String((Date.parse(m.at ?? isoIn(base, w.persona.tz)) / 1000) + i / 1000), read: true, ...m })) }])) };
  const github = { repos: (w.github?.repos ?? []).map((r: any) => ({ default_branch: "main", issues: [], pulls: [], ...r })) };
  return {
    profile: w.profile, mail, sent: [], drafts: [], events: fill(w.events, "ev"), cancelled: [],
    slack, github, notes: fill(w.notes, "n"), shop: { orders: [], products: [], customers: [], ...w.shop }, crm: { contacts: [], deals: [], ...w.crm },
    faults: {}, calls: [], errors: [], log: [],
  };
}
