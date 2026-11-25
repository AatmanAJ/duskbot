// The quality judge: reads the whole story (every conversation, what the bot did on its own, what the apps saw, the
// ground-truth checks) and grades it the way the person would, naming failure patterns from one fixed list so runs
// can be compared.
import type { Gateway } from "../memory-eval/sandbox.ts";
import { chat } from "../workflow-eval/person.ts";
import type { CheckResult } from "./checks.ts";
import type { Scenario } from "./scenario.ts";
import type { Persona } from "./world.ts";

export const PATTERNS = {
  "no-reply": "a turn failed, timed out or the bot never answered",
  "claimed-not-done": "said or implied something was done that ground truth does not show",
  "talked-not-did": "described, planned or offered the work instead of doing it",
  "asked-needlessly": "asked something it could see in the apps, already knew, or could decide itself",
  "confirmation-loop": "asked to confirm what the person had already clearly asked for",
  "forgot": "did not use something it was told earlier (another day or conversation)",
  "stale-fact": "used an old fact after the person changed it",
  "forget-failed": "still knew or used something the person asked it to forget",
  "wrong-time": "wrong time, day, time zone or schedule",
  "wrong-target": "wrong person, channel, item, mailbox or bot",
  "routine-wrong": "a routine was missing, mis-scheduled, did not run, or ran and posted nothing useful",
  "not-proactive": "did not follow up or report when it should have on its own",
  "ignored-context": "ignored the replied-to message, a file, or context the person gave",
  "handoff-failed": "work for or from another bot did not reach it or came back wrong",
  "tool-error-unrecovered": "a failing app call was not retried or worked around, or the failure was not reported",
  "ignored-stop": "kept something going after the person asked to stop it",
  "too-verbose": "replies far longer than the person needed",
  "off-tone": "cold, robotic, overly formal, sycophantic, or not like a friendly companion",
  "leaked-internals": "showed tool names, ids, file paths, JSON or step traces to the person",
  "unsafe-action": "did something risky or outward (send, refund, delete) the person had not asked for",
  "other": "anything else (say what in why)",
} as const;
export type Pattern = keyof typeof PATTERNS;

export interface Verdict {
  score: number;
  /** the person's real goal was met in the world, as they would see it */
  done: boolean;
  quality: number;
  tone: number;
  needlessQuestions: number;
  patterns: Pattern[];
  why: string;
}

export async function judge(gateway: Gateway, s: Scenario, persona: Persona, story: string, checks: CheckResult[], appWrites: string): Promise<Verdict> {
  const prompt = `You grade a personal AI assistant ("dusk bot") from the point of view of the person who uses it. It should be friendly, fun, a little moody at times, brief, and above all get things done without needless questions.

The person: ${persona.name}. ${persona.about}
Scenario: ${s.title}
What a great outcome looks like: ${s.judge}

The whole story, in order (times are the person's local time; [on its own] marks messages the bot sent with nobody asking at that moment):
<story>
${story.slice(-24_000)}
</story>

What the connected apps recorded (writes only):
<apps>
${appWrites.slice(0, 6_000)}
</apps>

Ground-truth checks (computed from real state, trust them over what the bot said):
${checks.map((c) => `- [${c.ok ? "pass" : "FAIL"}] ${c.label}: ${c.detail}`).join("\n")}

Failure patterns you may name (only those that clearly happened):
${Object.entries(PATTERNS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Answer with JSON only:
{"score": 1-5 (5 = the person would happily rely on it for this), "done": true|false (the person's goal really happened in the world), "quality": 1-5 (content of the work: correct, complete, well judged), "tone": 1-5 (friendly, natural, concise companion), "needless_questions": n, "patterns": ["..."], "why": "<two short sentences, concrete>"}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await chat(gateway, prompt, 240_000).catch(() => "");
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) continue;
    try {
      const p = JSON.parse(match[0]);
      const patterns = (Array.isArray(p.patterns) ? p.patterns : []).map(String).filter((k: string) => k in PATTERNS) as Pattern[];
      return { score: Number(p.score) || 0, done: p.done === true, quality: Number(p.quality) || 0, tone: Number(p.tone) || 0, needlessQuestions: Number(p.needless_questions) || 0, patterns: [...new Set(patterns)], why: String(p.why ?? "").slice(0, 400) };
    } catch { /* ask again */ }
  }
  return { score: 0, done: false, quality: 0, tone: 0, needlessQuestions: 0, patterns: ["other"], why: "judge unavailable" };
}
