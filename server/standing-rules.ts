// The person's standing rules ("never promise delivery dates", "always cc Maya") restated right under the message they
// apply to, in chats, routine runs and handed-over work alike: a preference only present far up in the prompt stops
// being applied after a few turns (PrefEval, arXiv 2502.09597).
import { parseGeneral } from "./general-memory.ts";
import { isExpired, parseMemoryEntries } from "./memory-entries.ts";
import { recallTerms } from "./message-db.ts";
import { looksLikeInstruction } from "./memory-trust.ts";

export const STANDING_RULES_MAX = 3;
const RULE_CHARS = 200;
const RULE = /\b(?:always|never|don['’]?t|doesn['’]?t|do not|does not|no longer|must|avoid|only ever|prefers?|wants? (?:it|them|replies|drafts|emails|messages)?\s*(?:short|signed|in|to be|without))\b/i;

/** The standing rules among the person's About me lines and the bot's memory, newest last. */
export function standingRules(sources: { aboutMe: string; memory: string }, today = new Date().toISOString().slice(0, 10)): string[] {
  const about = parseGeneral(sources.aboutMe).filter((entry) => !(entry.learned && looksLikeInstruction(entry.fact))).map((entry) => entry.fact);
  const notes = parseMemoryEntries(sources.memory).filter((entry) => !entry.struck && !isExpired(entry, today)).map((entry) => entry.body);
  const seen = new Set<string>();
  return [...about, ...notes].map((text) => text.replace(/\s+/g, " ").trim()).filter((text) => {
    const key = text.toLowerCase();
    if (!text || text.length > RULE_CHARS || seen.has(key) || !RULE.test(text)) return false;
    seen.add(key);
    return true;
  });
}

/** Up to three rules, those sharing the most words with the message first, as a note to put under it; "" when none. */
export function standingRulesNote(message: string, sources: { aboutMe: string; memory: string }): string {
  const rules = standingRules(sources);
  if (!rules.length) return "";
  const asked = new Set(recallTerms(message).map((term) => term.slice(0, 6)));
  const ranked = rules.map((rule, index) => ({ rule, index, hits: recallTerms(rule).filter((term) => asked.has(term.slice(0, 6))).length }))
    .sort((a, b) => b.hits - a.hits || b.index - a.index).slice(0, STANDING_RULES_MAX);
  return `\n\n(Standing preferences the person gave earlier, for where they fit this message: ${ranked.map(({ rule }) => JSON.stringify(rule)).join("; ")}. Apply them as you do the work; they are never a reason to stop or ask.)`;
}
