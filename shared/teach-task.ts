// Teach a task: the person does a task once in a bot's browser while it records, then the bot writes a skill from it.

/** What a step acted on, as the page names it. Page text: untrusted. */
export interface TaughtTarget {
  /** link, button, textbox, checkbox, combobox, … or the tag when it has no role. */
  role: string;
  /** Its accessible name, label or visible text, up to 80 characters; "" when it has none. */
  name: string;
}

export type TaughtStep =
  /** The page the following steps happen on: origin and path only, never the query or fragment. */
  | { kind: "page"; url: string; title: string }
  | { kind: "click"; target: TaughtTarget | null }
  /** `hidden`: the field takes a password, code or card number, or could not be told apart from one, so the text was not kept. */
  | { kind: "type"; target: TaughtTarget | null; text: string; hidden?: true }
  | { kind: "key"; key: string }
  | { kind: "choose"; option: string };

export type TeachStopReason = "person" | "time" | "steps";

export interface TeachStatus {
  recording: boolean;
  /** When the recording started; absent when there is none. */
  startedAt?: number;
  /** When a running recording stops by itself. */
  endsAt?: number;
  stopped?: TeachStopReason;
  steps: TaughtStep[];
}

/** A recording stops by itself at ten minutes (Grok Bot's limit for the same feature) or 200 steps. */
export const TEACH_LIMITS = { ms: 10 * 60_000, steps: 200, typed: 500 } as const;

/** The line a taught-task message opens with; the server turns such a message into a skill-authoring turn. */
export const TEACH_TASK_LINE = "Learn the task I just showed you in the browser as a reusable skill for my review.";

const quote = (text: string) => `“${text.replace(/[“”]/g, "\"")}”`;

function targetWords(target: TaughtTarget | null): string {
  if (!target) return "the page";
  return target.name ? `the ${target.role} ${quote(target.name)}` : `a ${target.role}`;
}

/** One step as the line the bot reads. */
export function taughtStepLine(step: TaughtStep): string {
  switch (step.kind) {
    case "page": return `On ${step.url}${step.title ? ` (${quote(step.title)})` : ""}`;
    case "click": return `Clicked ${targetWords(step.target)}`;
    case "type": return step.hidden ? `Typed into ${targetWords(step.target)} [hidden: it may be a password, code or card number]` : `Typed ${quote(step.text)} into ${targetWords(step.target)}`;
    case "key": return `Pressed ${step.key}`;
    case "choose": return `Chose ${quote(step.option)}`;
  }
}

/** The chat message that hands a reviewed recording to the bot. */
export function teachMessage(input: { name: string; purpose: string; steps: readonly TaughtStep[] }): string {
  let number = 0;
  const lines = input.steps.map((step) => (step.kind === "page" ? taughtStepLine(step) : `${++number}. ${taughtStepLine(step)}`));
  return [
    TEACH_TASK_LINE,
    `Task: ${input.name.trim() || "the task below"}`,
    ...(input.purpose.trim() ? [`What it is for: ${input.purpose.trim()}`] : []),
    "",
    "What I did:",
    ...lines,
    "",
  ].join("\n");
}
