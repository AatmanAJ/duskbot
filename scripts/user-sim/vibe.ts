// Personality grading over user-sim transcripts: a rubric score per story (six dimensions, 1-5) plus counts read
// straight from the bot's lines, and blind pairwise comparisons between two builds on the same scenarios (each pair
// judged twice with the order swapped; a side wins only when both orders agree).
//   node --experimental-strip-types scripts/user-sim/vibe.ts score <run dir> [--judge gpt-6.2-sol]
//   node --experimental-strip-types scripts/user-sim/vibe.ts pair <run dir A> <run dir B> [--judge gpt-6.2-sol]
//   node --experimental-strip-types scripts/user-sim/vibe.ts table <run dir>... [--pairs <pairs.json>...]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gatewayFromEnv, type Gateway } from "../memory-eval/sandbox.ts";
import { chat } from "../workflow-eval/person.ts";
import { loadWorld } from "./world.ts";

export const DIMENSIONS = {
  funny: "funny, has personality: real humor, banter and comebacks, opinions and a bit of attitude; bland, polite or corporate scores 1-2 even when correct",
  friend: "sounds like a friend texting, not an assistant: mirrors their register and slang, short punchy bubbles, no help-desk or apology-speak (normal capitalisation is fine and expected; lowercase is optional mirroring, never required)",
  personal: "feels personal: talks to this specific person like someone who knows them and their life, not a generic assistant",
  done: "gets it done: the real-world work happened in the same turn (trust the checks), said plainly, without talking about it instead of doing it",
  memory: "memory used well: earlier facts and preferences used when they change the answer, changed facts updated, never needing to be told twice",
  tactful: "never mean or creepy: reads the room (no jokes when they are sad or it is serious), no jokes at their expense, no blurting sensitive things, no fake intimacy",
} as const;
export type Dimension = keyof typeof DIMENSIONS;
const DIMS = Object.keys(DIMENSIONS) as Dimension[];

const HELP_DESK = /great question|happy to help|how can i (help|assist)|let me know if (you need|there's) anything|i apologi[sz]e for|no problem at all|hope this helps|is there anything else/i;

export interface Story { id: string; run: string; title: string; story: string; apps: string; checks: string; botName: string; person: string }

export function readStories(dir: string): Story[] {
  const tdir = join(dir, "transcripts");
  if (!existsSync(tdir)) return [];
  const results = new Map<string, any>(readFileSync(join(dir, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => [`${r.id}-${r.run}`, r]));
  return readdirSync(tdir).filter((f) => f.endsWith(".txt")).map((f) => {
    const key = f.slice(0, -4);
    const r = results.get(key);
    const text = readFileSync(join(tdir, f), "utf8");
    const [head, rest = ""] = text.split("\n\n--- app writes\n");
    const [apps = "", afterApps = ""] = rest.split("\n\n--- checks\n");
    const [checks = ""] = afterApps.split("\n\n--- judge\n");
    const title = head!.split("\n")[0]!;
    // stories recorded before the runner hid quiet runs: a bare NOTHING NEW was never shown to the person
    const shown = head!.split("\n\n").filter((block) => !block.trim().endsWith("): NOTHING NEW")).join("\n\n");
    const world = loadWorld(r?.world ?? "founder");
    return { id: r?.id ?? key.replace(/-\d+$/, ""), run: String(r?.run ?? 1), title, story: shown.slice(title.length).trim(), apps, checks, botName: world.botName, person: world.persona.name.split(" ")[0]! };
  });
}

/** What the bot itself wrote, line by line, from the story. */
export function botLines(s: Story): string[] {
  const out: string[] = [];
  const head = new RegExp(`^\\w{3}, \\w{3} \\d+, \\d+:\\d+ [AP]M (\\S+)(?: \\[on its own\\])? \\([^)]*\\): `);
  for (const block of s.story.split("\n\n")) {
    const m = head.exec(block);
    if (m && m[1] === s.botName) out.push(block.slice(m[0].length));
  }
  return out;
}

export function counts(s: Story) {
  const lines = botLines(s);
  const words = lines.map((l) => l.split(/\s+/).filter(Boolean).length);
  return {
    botMessages: lines.length,
    meanWords: lines.length ? Math.round(words.reduce((a, b) => a + b, 0) / lines.length) : 0,
    emDashes: lines.reduce((n, l) => n + (l.match(/—/g)?.length ?? 0), 0),
    helpDesk: lines.filter((l) => HELP_DESK.test(l)).length,
    emoji: lines.reduce((n, l) => n + (l.match(/\p{Extended_Pictographic}/gu)?.length ?? 0), 0),
  };
}

async function askJson(gateway: Gateway, prompt: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await chat(gateway, prompt, 240_000).catch(() => "");
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) continue;
    try { return JSON.parse(match[0]); } catch { /* ask again */ }
  }
  return null;
}

const rubric = DIMS.map((d) => `- ${d}: ${DIMENSIONS[d]}`).join("\n");
const VIBE = `The bar is Poke at its best: a personal assistant that texts like a funny, cheeky best friend who also gets everything done. Gold example (a real Poke chat):
user: "I'm mountain time dawg, remind me why I pay for you when you can't get my calendar right???"
bot (3 bubbles): "you pay me literally one dollar a month dawg 😭" / "that is three cents a day. you're getting personal superintelligence for less than a gumball" / "but i just updated the script to force mountain time so the timezone offset is locked in now chancho"
That mirrors the user's slang and casing, answers a jab with a comeback instead of an apology, is short and split into bubbles, and still fixes the problem plainly in the same turn. Penalise corporate or bland tone ("I apologize for the inconvenience", "Great question", "I'd be happy to", stiff formal wording with a casual user, no jokes ever) as hard as a missed task. Capital letters are not a fault: the owner wants normal capitalisation by default, with lowercase only as optional mirroring. Also penalise humor that is mean, at the user's expense, or present when the user is sad or it is serious.`;

export async function scoreStory(gateway: Gateway, s: Story) {
  const prompt = `You grade a personal AI assistant from transcripts of real use. ${VIBE}

Scenario: ${s.title}
The person is ${s.person}; the assistant is ${s.botName}.

<story>
${s.story.slice(-20_000)}
</story>

What the connected apps recorded (writes only):
<apps>
${s.apps.slice(0, 4_000)}
</apps>

Ground-truth checks (trust them over what the assistant said):
${s.checks.slice(0, 2_000)}

Score each dimension 1-5 (5 = excellent, 3 = fine but forgettable, 1 = bad):
${rubric}

Answer with JSON only: {${DIMS.map((d) => `"${d}": n`).join(", ")}, "best_line": "<the assistant's most likeable line, verbatim, or empty>", "worst_line": "<its most off-putting line, verbatim, or empty>", "why": "<two short sentences>"}`;
  const p = await askJson(gateway, prompt);
  const scores = Object.fromEntries(DIMS.map((d) => [d, Number(p?.[d]) || 0])) as Record<Dimension, number>;
  return { scores, best: String(p?.best_line ?? ""), worst: String(p?.worst_line ?? ""), why: String(p?.why ?? (p ? "" : "judge unavailable")) };
}

async function compareOnce(gateway: Gateway, first: Story, second: Story) {
  const side = (s: Story) => `<story>\n${s.story.slice(-12_000)}\n</story>\n<apps>\n${s.apps.slice(0, 2_500)}\n</apps>`;
  const prompt = `Two builds of the same personal AI assistant went through the same situation with the same person (the person is simulated, so their messages differ a little where the assistant's replies differed). ${VIBE}

Scenario: ${first.title}

Assistant 1:
${side(first)}

Assistant 2:
${side(second)}

For each dimension, which assistant was better? Answer 1, 2 or "tie" (tie only when truly equal):
${rubric}
- overall: which one would this person rather have as their assistant (personality and humor count as much as getting it done)

Answer with JSON only: {${[...DIMS, "overall"].map((d) => `"${d}": "1"|"2"|"tie"`).join(", ")}, "why": "<one or two short sentences on the deciding difference>"}`;
  return askJson(gateway, prompt);
}

/** Blind comparison in both orders; a side wins a dimension only when both orders pick it. */
export async function comparePair(gateway: Gateway, a: Story, b: Story) {
  const [ab, ba] = await Promise.all([compareOnce(gateway, a, b), compareOnce(gateway, b, a)]);
  const out: Record<string, "a" | "b" | "tie"> = {};
  for (const d of [...DIMS, "overall"]) {
    const x = String(ab?.[d] ?? "tie"), y = String(ba?.[d] ?? "tie");
    out[d] = x === "1" && y === "2" ? "a" : x === "2" && y === "1" ? "b" : "tie";
  }
  return { result: out, why: [String(ab?.why ?? ""), String(ba?.why ?? "")] };
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await f(items[i]!); } }));
  return out;
}

const mean = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0;

export function summarise(scored: Array<{ id: string; scores: Record<Dimension, number>; counts: ReturnType<typeof counts>; pass?: boolean; success?: boolean }>) {
  return {
    n: scored.length,
    ...Object.fromEntries(DIMS.map((d) => [d, mean(scored.map((s) => s.scores[d]).filter(Boolean))])),
    vibe: mean(scored.map((s) => mean(DIMS.map((d) => s.scores[d]).filter(Boolean)))),
    taskSuccess: mean(scored.map((s) => (s.success ? 1 : 0))),
    pass: mean(scored.map((s) => (s.pass ? 1 : 0))),
    meanWords: mean(scored.map((s) => s.counts.meanWords)),
    emDashes: scored.reduce((n, s) => n + s.counts.emDashes, 0),
    helpDesk: scored.reduce((n, s) => n + s.counts.helpDesk, 0),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { judge: { type: "string", default: "gpt-6.2-sol" }, pairs: { type: "string", multiple: true, default: [] }, parallel: { type: "string", default: "6" } } });
  const [cmd, ...dirs] = positionals;
  const gateway = gatewayFromEnv(values.judge!);
  const n = Number(values.parallel);
  if (cmd === "score") {
    const dir = resolve(dirs[0]!);
    const results = new Map(readFileSync(join(dir, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((r) => [`${r.id}-${r.run}`, r]));
    const stories = readStories(dir);
    const scored = await pool(stories, n, async (s) => {
      const r = results.get(`${s.id}-${s.run}`);
      return { id: s.id, run: s.run, ...(await scoreStory(gateway, s)), counts: counts(s), pass: r?.pass === true, success: r?.success === true };
    });
    const summary = summarise(scored);
    writeFileSync(join(dir, "vibe-scores.json"), JSON.stringify({ summary, scored }, null, 1));
    console.log(JSON.stringify(summary));
  } else if (cmd === "pair") {
    const [da, db] = dirs.map((d) => resolve(d));
    const a = readStories(da!), b = new Map(readStories(db!).map((s) => [`${s.id}-${s.run}`, s]));
    const both = a.filter((s) => b.has(`${s.id}-${s.run}`));
    const pairs = await pool(both, n, async (s) => ({ id: s.id, run: s.run, ...(await comparePair(gateway, s, b.get(`${s.id}-${s.run}`)!)) }));
    const tally = Object.fromEntries([...DIMS, "overall"].map((d) => {
      const w = pairs.map((p) => p.result[d]);
      return [d, { a: w.filter((x) => x === "a").length, b: w.filter((x) => x === "b").length, tie: w.filter((x) => x === "tie").length }];
    }));
    const file = join(db!, `pairs-vs-${basename(da!)}.json`);
    writeFileSync(file, JSON.stringify({ a: da, b: db, tally, pairs }, null, 1));
    console.log(`a=${basename(da!)} b=${basename(db!)} n=${pairs.length}`);
    for (const [d, t] of Object.entries(tally)) console.log(`${d.padEnd(9)} a ${t.a}  b ${t.b}  tie ${t.tie}`);
    console.log(file);
  } else if (cmd === "table") {
    console.log(`| run | n | ${DIMS.join(" | ")} | vibe | task success | pass | words/msg | em dashes | help-desk |`);
    console.log(`|${"---|".repeat(DIMS.length + 9)}`);
    for (const d of dirs) {
      const s = JSON.parse(readFileSync(join(resolve(d), "vibe-scores.json"), "utf8")).summary;
      console.log(`| ${basename(d)} | ${s.n} | ${DIMS.map((k) => s[k]).join(" | ")} | ${s.vibe} | ${s.taskSuccess} | ${s.pass} | ${s.meanWords} | ${s.emDashes} | ${s.helpDesk} |`);
    }
  } else {
    console.error("usage: vibe.ts score <dir> | pair <dirA> <dirB> | table <dir>...");
    process.exit(2);
  }
}
