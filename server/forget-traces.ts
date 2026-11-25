// What a daily-log line may keep once the person had something forgotten: the conversation that asked to forget it
// logs no words of its own for a while (its words name what was forgotten), and no line keeps a source quote or text
// that names a forgotten fact.
import { forgottenTraces } from "./profile-learned.ts";

const FORGET_TURN_MS = 10 * 60_000;
const MAX_KEPT = 500;
const recent = new Map<string, number>();
const SOURCE_QUOTE = /\s*"(?:[^"\\]|\\.)*"/;
/** A chat titled by its first message, when that message asked to forget something. */
export const FORGET_ASK = /(?<!\b(?:don['’]t|do not|never|not)\s+)\b(?:forget (?:about|the|that|this|what|my|i|it|everything)|unlearn|erase|stop remembering|(?:don['’]t|do not) (?:remember|save|keep) (?:that|this|it))\b/i;

/** A forget ran in this memory layer, in the conversation `source` names. */
export function noteForget(layer: string, source: string, now = Date.now()): void {
  recent.delete(`${layer}\n${source}`);
  recent.set(`${layer}\n${source}`, now);
  if (recent.size > MAX_KEPT) recent.delete(recent.keys().next().value!);
}

/** The source and text a log line keeps, or null when the line names a forgotten fact and is left out. */
export function logLineAfterForget(layer: string, source: string, text: string, now = Date.now()): { source: string; text: string } | null {
  const forgotAt = recent.get(`${layer}\n${source}`);
  const traces = forgottenTraces();
  const quote = SOURCE_QUOTE.exec(source)?.[0] ?? "";
  const keptSource = quote && (forgotAt !== undefined || FORGET_ASK.test(quote) || traces(quote)) ? source.replace(SOURCE_QUOTE, "") : source;
  if (forgotAt !== undefined && now - forgotAt < FORGET_TURN_MS) return { source: keptSource, text: "Forgot what the person asked to forget." };
  return traces(text) ? null : { source: keptSource, text };
}
