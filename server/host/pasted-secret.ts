// A secret the person already wrote in their own message (a NAME=value line, "Hindsight token: x"): the server takes it
// from the stored message, so the model never has to copy the value into a tool call and no card asks for it again.
import type { Message } from "../store.ts";
import { SECRET_VALUE_MAX_BYTES } from "../secret-vault.ts";

/** How far back a pasted value is still the person's answer: their last few messages on the visible branch. */
const RECENT_PERSON_MESSAGES = 12;
const MIN_VALUE_LENGTH = 3;
const LONG_VALUE = 12;

function nameSource(name: string): string | null {
  const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return null;
  return words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_.-]*");
}

/** A key, token or address, not a word of prose ("Hindsight token: here it is") or a placeholder. */
function looksLikeValue(value: string): boolean {
  if (value.length < MIN_VALUE_LENGTH || Buffer.byteLength(value) > SECRET_VALUE_MAX_BYTES) return false;
  if (/^<.*>$/.test(value) || /^(?:x+|\.+|\*+|your[_-].*|changeme)$/i.test(value)) return false;
  return /\d/.test(value) || value.length >= LONG_VALUE;
}

/** The value written under `name` in one line of text, if any. */
export function valueUnderName(text: string, name: string): string | null {
  const source = nameSource(name);
  if (!source) return null;
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])(?:export\\s+)?${source}["'\`]?\\s*[=:]\\s*["'\`]?([^\\s"'\`]+)`,
    "iu",
  );
  for (const line of text.split(/\r?\n/)) {
    const value = pattern.exec(line)?.[1]?.replace(/[,;.]+$/, "");
    if (value && looksLikeValue(value)) return value;
  }
  return null;
}

/** The newest value the person wrote under any of `names` in their own recent messages; never a bot's text. */
export function pastedSecret(path: readonly Message[], names: readonly string[]): string | null {
  let seen = 0;
  for (let index = path.length - 1; index >= 0 && seen < RECENT_PERSON_MESSAGES; index--) {
    const message = path[index]!;
    if (message.role !== "user" || typeof message.text !== "string") continue;
    seen++;
    for (const name of names) {
      const value = valueUnderName(message.text, name);
      if (value) return value;
    }
  }
  return null;
}
