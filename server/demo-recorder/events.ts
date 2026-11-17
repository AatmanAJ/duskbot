import type { DemoTarget } from "../../shared/demo-recording.ts";

/** An element as the page script reports it: the words of a `DemoTarget`, plus what the cleanup needs to know. */
export interface RawDemoTarget extends DemoTarget {
  tag: string;
  inputType?: string;
  /** The same number for every field of one form in one document. */
  form?: number;
  /** The page keeps this field's value private; the script never reads it. */
  sensitive?: boolean;
  /** A control or a link, or something inside one: a click here does something. */
  interactive?: boolean;
  /** Text can be typed into it. */
  editable?: boolean;
  /** For a password box: how many password boxes its form shows. One is a sign-in; more is a form that sets a password. */
  passwords?: number;
  /** For a password box: how many other fields its form shows. A sign-in has a name beside the password and little else. */
  fields?: number;
  /** A password box the page marks as taking a new password. */
  newPassword?: boolean;
}

export const RAW_DEMO_EVENT_TYPES = ["open", "click", "input", "change", "key", "submit", "focus", "blur", "scroll"] as const;
export type RawDemoEventType = (typeof RAW_DEMO_EVENT_TYPES)[number];

/** One thing the page saw the person do. It never carries a point on screen, and never a sensitive field's value. */
export interface RawDemoEvent {
  at: number;
  type: RawDemoEventType;
  /** The address of the document the event happened in. */
  url: string;
  target?: RawDemoTarget;
  value?: string;
  checked?: boolean;
  key?: string;
  /** The label of the option a list now shows. */
  option?: string;
  /** The names of the files a file picker was given, never their paths. */
  files?: string[];
}

/** What one read of the page answers. */
export interface DemoDrain {
  installed: boolean;
  url: string;
  title: string;
  events: RawDemoEvent[];
  /** The page holds more than one read answers: read again. */
  more?: boolean;
}

export const DEMO_WORDS_MAX = 200;
export const DEMO_VALUE_MAX = 2_000;
const URL_MAX = 2_000;
const KEYS = new Set(["Enter", "Escape", "Tab"]);

const chars = (from: number, to = from) => (from === to ? String.fromCodePoint(from) : `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`);
/** Characters that draw nothing or reorder what is drawn: controls, zero-width marks and the bidirectional overrides. */
const HIDDEN = `${chars(0x7f, 0x9f)}${chars(0x200b, 0x200f)}${chars(0x202a, 0x202e)}${chars(0x2060, 0x2069)}${chars(0xfeff)}`;
const HIDDEN_IN_WORDS = new RegExp(`[${chars(0x00, 0x1f)}${HIDDEN}]`, "gu");
const HIDDEN_IN_TEXT = new RegExp(`[${chars(0x00, 0x08)}${chars(0x0b, 0x0c)}${chars(0x0e, 0x1f)}${HIDDEN}]`, "gu");

/** Page words as one line: no control or invisible characters, single spaces, at most `max` characters. */
export function demoWords(value: unknown, max = DEMO_WORDS_MAX): string {
  if (typeof value !== "string") return "";
  return value.replace(HIDDEN_IN_WORDS, " ").replace(/\s+/gu, " ").trim().slice(0, max).trim();
}

/** What a field holds: its lines kept, invisible characters and anything past `DEMO_VALUE_MAX` dropped. */
export function demoValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/gu, "\n").replace(HIDDEN_IN_TEXT, "").slice(0, DEMO_VALUE_MAX);
}

/** Names a parameter carries a secret under, wherever they stand in its name. */
const PRIVATE_PARAM = /token|secret|passw|pwd|auth|session|signature|credential|jwt|saml|assertion|apikey|otp|nonce|ticket/iu;
/** Names that mean a secret only as a whole word: `code` and `key`, but not `zipcode` or `keyword`. */
const PRIVATE_WORD = new Set(["code", "key", "sig", "sid", "pass", "pin"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Text that reads as a generated secret rather than as words or an id: long, unbroken, letters and digits mixed. */
function tokenLike(text: string): boolean {
  let plain = text;
  try { plain = decodeURIComponent(text); } catch {}
  if (plain.length < 32 || UUID.test(plain)) return false;
  return /^[\w+/=.~-]+$/u.test(plain) && /[a-z]/iu.test(plain) && /\d/u.test(plain);
}

function privateParam(key: string, value: string): boolean {
  if (PRIVATE_PARAM.test(key) || tokenLike(value)) return true;
  return key.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase().split(/[^a-z0-9]+/u).some((word) => PRIVATE_WORD.has(word));
}

/**
 * A web address a recording may keep: http or https only, without credentials and without the parameters that carry a
 * token. An address whose path or fragment is itself a token (a reset or invitation link) is not kept at all.
 */
export function demoUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8_192) return "";
  let url: URL;
  try { url = new URL(value); } catch { return ""; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  url.username = "";
  url.password = "";
  if (url.pathname.split("/").some(tokenLike)) return "";
  for (const [key, held] of Array.from(url.searchParams.entries())) if (privateParam(key, held)) url.searchParams.delete(key);
  if (!/^#!?\/[\w\-./~%]*$/u.test(url.hash) || url.hash.split("/").some(tokenLike)) url.hash = "";
  return url.href.length > URL_MAX ? "" : url.href;
}

function sanitiseTarget(raw: unknown): RawDemoTarget | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const from = raw as Record<string, unknown>;
  const role = demoWords(from.role, 40).toLowerCase().replace(/[^a-z]/gu, "");
  if (!role) return undefined;
  const target: RawDemoTarget = { role, name: demoWords(from.name), tag: demoWords(from.tag, 40).toLowerCase() };
  for (const key of ["label", "within", "placeholder"] as const) {
    const words = demoWords(from[key], key === "placeholder" ? DEMO_WORDS_MAX : 80);
    if (words) target[key] = words;
  }
  const testId = demoWords(from.testId, 80);
  if (testId) target.testId = testId;
  const inputType = demoWords(from.inputType, 40).toLowerCase();
  if (inputType) target.inputType = inputType;
  if (typeof from.form === "number" && Number.isInteger(from.form) && from.form > 0 && from.form < 100_000) target.form = from.form;
  for (const key of ["sensitive", "interactive", "editable", "newPassword"] as const) if (from[key] === true) target[key] = true;
  for (const key of ["passwords", "fields"] as const) {
    const count = from[key];
    if (typeof count === "number" && Number.isInteger(count) && count >= 0 && count < 10_000) target[key] = count;
  }
  return target;
}

/**
 * One event as the server keeps it, or null for anything that is not one. The page is not trusted: only known fields
 * survive, words are made one clean line, and a private field's event never keeps a value even if the page sent one.
 */
export function sanitiseDemoEvent(raw: unknown, scrub: (text: string) => string = (text) => text): RawDemoEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const from = raw as Record<string, unknown>;
  const type = from.type as RawDemoEventType;
  if (!RAW_DEMO_EVENT_TYPES.includes(type)) return null;
  if (typeof from.at !== "number" || !Number.isFinite(from.at)) return null;
  if (typeof from.url !== "string") return null;
  const event: RawDemoEvent = { at: from.at, type, url: from.url.slice(0, 8_192) };
  const target = sanitiseTarget(from.target);
  if (target) event.target = target;
  const open = !target?.sensitive;
  if (open && typeof from.value === "string") event.value = scrub(demoValue(from.value));
  if (typeof from.checked === "boolean") event.checked = from.checked;
  if (typeof from.key === "string" && KEYS.has(from.key)) event.key = from.key;
  if (open && typeof from.option === "string") event.option = scrub(demoWords(from.option));
  if (open && Array.isArray(from.files)) event.files = from.files.slice(0, 20).map((name) => scrub(demoWords(name))).filter(Boolean);
  if (type === "key" && !event.key) return null;
  return event;
}
