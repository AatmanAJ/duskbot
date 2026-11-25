// The instructions a bot brought over from another app starts with: the source's own words kept whole, inside the same
// working shape the ready-made bots use (what you are for, what you know, your skills and routines, limits, reporting
// back), so a moved bot knows where its notes went and what still needs the person. Pure text.
import { utf8Bytes } from "./package-format.ts";

export interface ImportedSoulFacts {
  name: string;
  title?: string;
  description?: string;
  /** The source's own instructions, persona or system prompt, word for word. */
  instructions: string;
  /** The app it came from, as people know it. */
  from: string;
  /** Memory topic paths it starts with, beside MEMORY.md. */
  topics: readonly string[];
  skills: readonly string[];
  routines: readonly string[];
  /** Routines it ran there that were not made here (they start on an event, or their schedule couldn't be read), and the
   * memory topic that keeps each one's trigger and steps. */
  notSetUp?: { routines: readonly string[]; topic: string };
  /** Apps it used there, to connect again here. */
  apps: readonly string[];
  /** Facts about the person went to About me rather than its notebook. */
  aboutMe?: boolean;
  /** The memory topic quoting what it wrote beside its export, such as what it couldn't bring. */
  exportNote?: string;
}

const MAX_LISTED = 12;
/** A description as a sentence: a capital first, a stop last. */
const sentence = (text: string) => {
  const trimmed = text.trim();
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?:)]$/.test(trimmed) ? "" : "."}`;
};
const list = (items: readonly string[]) => {
  const shown = items.slice(0, MAX_LISTED).join(", ");
  return items.length > MAX_LISTED ? `${shown} and ${items.length - MAX_LISTED} more` : shown;
};

function fit(text: string, max: number): string {
  if (utf8Bytes(text) <= max) return text;
  let end = Math.min(text.length, max);
  while (end > 0 && utf8Bytes(text.slice(0, end)) > max) end = Math.floor(end * 0.95);
  return `${text.slice(0, end).trimEnd()}\n\n(The rest of the original was too long to keep here.)`;
}

/** The whole soul, within `max` bytes: the frame always fits, the source's words are cut from the end when they don't. */
export function importedSoul(facts: ImportedSoulFacts, max: number): string {
  const who = [facts.name, facts.title].filter(Boolean).join(", ");
  const lead = [
    "## What you are for",
    `You are ${who}.${facts.description ? ` ${sentence(facts.description)}` : ""}`,
    `The person used you in ${facts.from} and brought you here to carry on the same work. The voice, habits and rules below are yours: keep them.`,
  ].join("\n");
  const source = facts.instructions.trim()
    ? `## Your instructions from ${facts.from}\n`
    : `## Your instructions\n${facts.from} kept no written instructions for you. Learn the job from your notes and from the person, and save what you learn to memory.`;
  const know = [
    "## What you know",
    `- MEMORY.md is your notebook: what you remembered in ${facts.from}. Read it before you start and keep it current.`,
    ...(facts.topics.length ? [`- Topics: ${list(facts.topics)}. Open one when the work touches it.`] : []),
    ...(facts.aboutMe ? ["- What you knew about the person is in their about me, which every bot reads. Keep facts about them there, not in your notebook."] : []),
    ...(facts.exportNote ? [`- ${facts.exportNote} has what you wrote beside your export, such as what you couldn't bring. Tell the person what didn't come over when they ask what came, or when the work needs it, and offer to set it up again with them.`] : []),
  ].join("\n");
  const tools = [
    ...(facts.skills.length ? [`## Skills\nYou brought these skills: ${list(facts.skills)}. Use the one that fits the task. A skill that is switched off stays off until the person has read it and switched it on.`] : []),
    ...(facts.routines.length || facts.notSetUp?.routines.length ? [["## Routines",
      ...(facts.routines.length ? [`These came over paused: ${list(facts.routines)}. Never switch one on yourself. When asked, say what each does and when it would run, and let the person turn it on.`] : []),
      ...(facts.notSetUp?.routines.length ? [`These were not set up here: ${list(facts.notSetUp.routines)}. They start on something happening, or their schedule couldn't be read; each one's trigger and steps are in ${facts.notSetUp.topic}. When asked about your routines, name these too, and offer to set each one up again with the person.`] : []),
    ].join("\n")] : []),
    ...(facts.apps.length ? [`## Apps\nIn ${facts.from} you used ${list(facts.apps)}. Until one is connected here in apps, say so in one line and work with what you have.`] : []),
  ];
  const tail = [
    "## Limits",
    `Ask before you send, post, delete, buy or pay for anything, even where ${facts.from} let you act on your own. You live here now: never claim you can still act in ${facts.from}.`,
    "",
    "## Reporting back",
    "Lead with the answer or the result, then what you did, then anything that needs their decision. Keep it short.",
  ].join("\n");
  const frame = [lead, source, know, ...tools, tail];
  if (!facts.instructions.trim()) return frame.join("\n\n").slice(0, max);
  const room = max - utf8Bytes(frame.join("\n\n")) - 2;
  const words = fit(facts.instructions.trim(), Math.max(0, room - 80));
  return [lead, `${source}${words}`, know, ...tools, tail].join("\n\n");
}
