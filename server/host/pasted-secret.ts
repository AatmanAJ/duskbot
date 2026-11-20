// A secret the person already wrote in their own message (a NAME=value line, "Hindsight token: x"): the server takes it
// from the stored message, so the model never has to copy the value into a tool call and no card asks for it again.
import type { Message } from "../store.ts";
import { SECRET_VALUE_MAX_BYTES } from "../secret-vault.ts";

/** A pasted block counts for the whole recent conversation, not only the last few turns. */
const RECENT_PERSON_MESSAGES = 200;
const MIN_VALUE_LENGTH = 3;
const LONG_VALUE = 12;
/** Words that say what kind of secret it is, not which: NITTER_KEY, "Nitter access key" and NITTER_API_TOKEN are one. */
const FILLER = new Set(["access", "api", "token", "tokens", "key", "keys", "secret", "secrets", "auth", "bearer", "credential",
  "credentials", "the", "my", "your", "a", "an", "for", "personal", "private", "mcp", "server", "service"]);

const wordsOf = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Two names for one secret: the same words, or the same words once the kind words (key, token, access...) are set aside. */
export function sameSecretName(a: string, b: string): boolean {
  const left = wordsOf(a), right = wordsOf(b);
  if (!left.length || !right.length) return false;
  if (left.join(" ") === right.join(" ")) return true;
  const core = (words: string[]) => [...new Set(words.filter((word) => !FILLER.has(word)))].sort().join(" ");
  const leftCore = core(left);
  return leftCore !== "" && leftCore === core(right);
}

/** A key, token or address, not a word of prose ("Hindsight token: here it is") or a placeholder. */
function looksLikeValue(value: string): boolean {
  if (value.length < MIN_VALUE_LENGTH || Buffer.byteLength(value) > SECRET_VALUE_MAX_BYTES) return false;
  if (/^<.*>$/.test(value) || /^(?:x+|\.+|\*+|your[_-].*|changeme)$/i.test(value)) return false;
  return /\d/.test(value) || value.length >= LONG_VALUE;
}

const ENV_PAIR = /(?:^|[^\w$])(?:export\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=\s*["'`]?([^\s"'`]+)/g;
const LABEL_PAIR = /^[\s>*\-•]*(?:export\s+)?(\p{L}[\p{L}\p{N}_ .-]{0,60}?)\s*[:=]\s*["'`]?([^\s"'`]+)/u;

/** Every name and value written as NAME=value or "Some name: value" in a text, in reading order. */
export function namedValues(text: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const labelled = LABEL_PAIR.exec(line);
    if (labelled) out.push({ name: labelled[1]!.trim(), value: labelled[2]! });
    for (const pair of line.matchAll(ENV_PAIR)) {
      if (!labelled || pair[1] !== labelled[1]!.trim()) out.push({ name: pair[1]!, value: pair[2]! });
    }
  }
  return out.map(({ name, value }) => ({ name, value: value.replace(/[,;.]+$/, "") })).filter(({ value }) => looksLikeValue(value));
}

/** The value written under a name that means `name` in one text, if any. */
export function valueUnderName(text: string, name: string): string | null {
  return namedValues(text).find((pair) => sameSecretName(pair.name, name))?.value ?? null;
}

/** The newest value the person wrote under any of `names` in their own messages on this branch; never a bot's text. */
export function pastedSecret(path: readonly Message[], names: readonly string[]): string | null {
  let seen = 0;
  for (let index = path.length - 1; index >= 0 && seen < RECENT_PERSON_MESSAGES; index--) {
    const message = path[index]!;
    if (message.role !== "user" || typeof message.text !== "string") continue;
    seen++;
    const pairs = namedValues(message.text).reverse();
    for (const pair of pairs) if (names.some((name) => sameSecretName(pair.name, name))) return pair.value;
  }
  return null;
}
