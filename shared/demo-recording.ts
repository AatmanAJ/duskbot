// Show it once: what a recorded demonstration is on the wire, in the saved skill and in the app.
// Security: nothing here can hold a secret. A field the page marks sensitive is recorded as a step that names the
// Vault, with no value, and a target is only ever words about an element (role, name, label), never a point on screen.

/** An element as a person would name it. */
export interface DemoTarget {
  /** The accessible role: button, link, textbox, combobox, checkbox, radio, and so on. */
  role: string;
  /** The accessible name, from aria-label, a label element, the element's own text or its title. */
  name: string;
  /** The words beside a field that has no label of its own, as in a table laid out by hand. */
  label?: string;
  /** The group the element sits in: a fieldset's legend or the nearest heading above it. */
  within?: string;
  placeholder?: string;
  /** The value of data-testid, when the page has one. */
  testId?: string;
}

export const DEMO_STEP_KINDS = ["open", "click", "fill", "select", "choose", "check", "press", "upload", "sign-in", "protected"] as const;
export type DemoStepKind = (typeof DEMO_STEP_KINDS)[number];

/**
 * One thing the person did, with the noise already taken out.
 * - open: went to `url`.
 * - click: clicked `target`.
 * - fill: `target` holds `value` afterwards.
 * - select: chose the option labelled `value` in the list `target`.
 * - choose: picked the radio button named `value` in the group `target`.
 * - check: set the checkbox `target` to `checked`.
 * - press: pressed `key` (Enter or Escape) in `target`.
 * - upload: gave `target` the file named `value`.
 * - sign-in: signed in to `site`; the saved login in the Vault is typed in on replay.
 * - protected: typed into a field the page keeps private (a card number, a code); never recorded, a person fills it.
 */
export interface DemoStep {
  id: string;
  kind: DemoStepKind;
  target?: DemoTarget;
  url?: string;
  /** What the person typed or chose. A blank's value is only its example. */
  value?: string;
  /** The name of the input that replaces `value` on each run; absent when the value never changes. */
  blank?: string;
  checked?: boolean;
  key?: string;
  /** The host a sign-in step signs in to. */
  site?: string;
}

export const DEMO_BLANK_KINDS = ["text", "choice", "toggle", "file"] as const;
export type DemoBlankKind = (typeof DEMO_BLANK_KINDS)[number];

/** A named input of the saved skill. */
export interface DemoBlank {
  /** Lowercase words joined by underscores, 1-40 characters: amount, expense_date. */
  name: string;
  /** What the field was called on the page. */
  label: string;
  /** What the person entered while showing the task. */
  example: string;
  kind: DemoBlankKind;
}

/** A demonstration ready to save and replay. */
export interface DemoRecording {
  v: 1;
  title: string;
  /** Where the task starts. */
  startUrl: string;
  steps: DemoStep[];
  blanks: DemoBlank[];
}

export type DemoDraftState = "idle" | "recording" | "review";

/** Where the person is showing the task: the bot's own browser, or the browser on its computer. */
export type DemoPlace = "browser" | "computer";

/** A bot's recording as the app shows it while it is made and reviewed. */
export interface DemoDraft {
  botId: string;
  state: DemoDraftState;
  place: DemoPlace;
  startedAt: number | null;
  title: string;
  startUrl: string;
  steps: DemoStep[];
  blanks: DemoBlank[];
  /** Whether the names of the blanks came from the AI or from the page's own labels. */
  named: "ai" | "labels" | null;
  /** Bumped by every change, so a late answer never overwrites a newer list. */
  revision: number;
}

export const DEMO_BLANK_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
export const DEMO_BLANK_NAME_MAX = 40;
export const DEMO_TITLE_MAX = 80;
/** The longest value a step may hold. */
export const DEMO_VALUE_MAX_WIRE = 2_000;
/** A saved recording's steps must fit one 32 KB reference file of a skill. */
export const DEMO_MAX_STEPS = 100;

/** A blank name from any words: "Amount (USD)" becomes amount_usd. Empty when the words hold no letter or digit. */
export function demoBlankName(words: string): string {
  const slug = words
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, DEMO_BLANK_NAME_MAX)
    .replace(/_+$/u, "");
  if (!slug) return "";
  return /^[a-z]/u.test(slug) ? slug : `field_${slug}`.slice(0, DEMO_BLANK_NAME_MAX);
}

export function isDemoBlankName(name: string): boolean {
  return name.length <= DEMO_BLANK_NAME_MAX && DEMO_BLANK_NAME.test(name);
}

/** How a blank is written in a step's sentence and in the skill: {{amount}}. */
export function demoBlankMark(name: string): string {
  return `{{${name}}}`;
}

/** Words from a page or a file inside a sentence: one line in double quotes, so a quote mark or a line break in them
 * never ends the quotation and never reads as part of the sentence. */
export function demoQuoted(words: string): string {
  return JSON.stringify(words);
}

/** What an element is called in a sentence: the "Submit report" button, the field labelled "Amount". */
export function demoTargetWords(target: DemoTarget | undefined): string {
  if (!target) return "the page";
  const name = target.name || target.label || target.placeholder || "";
  const group = target.within && target.within !== name ? ` under ${demoQuoted(target.within)}` : "";
  const quoted = name ? demoQuoted(name) : "";
  switch (target.role) {
    case "button": return quoted ? `the ${quoted} button${group}` : `a button${group}`;
    case "link": return quoted ? `the ${quoted} link${group}` : `a link${group}`;
    case "textbox":
    case "searchbox":
    case "spinbutton": return quoted ? `the field labelled ${quoted}${group}` : `a text field${group}`;
    case "combobox":
    case "listbox": return quoted ? `the ${quoted} list${group}` : `a list${group}`;
    case "checkbox": return quoted ? `the ${quoted} checkbox${group}` : `a checkbox${group}`;
    case "radio": return quoted ? `the ${quoted} option${group}` : `an option${group}`;
    case "radiogroup": return quoted ? `the ${quoted} choices` : "the choices";
    case "tab": return quoted ? `the ${quoted} tab${group}` : `a tab${group}`;
    case "menuitem": return quoted ? `the ${quoted} menu item${group}` : `a menu item${group}`;
    case "file": return quoted ? `the ${quoted} file picker${group}` : `the file picker${group}`;
    default: return quoted ? `${quoted}${group}` : `the ${target.role || "element"}${group}`;
  }
}

/** One step as an instruction a bot or a person can follow, blanks written as {{name}}. */
export function demoStepSentence(step: DemoStep): string {
  const where = demoTargetWords(step.target);
  const value = step.blank ? demoBlankMark(step.blank) : demoQuoted(step.value ?? "");
  switch (step.kind) {
    case "open": return `Open ${step.url ?? "the page"}.`;
    case "click": return `Click ${where}.`;
    case "fill": return `Type ${value} into ${where}.`;
    case "select": return `Choose ${value} in ${where}.`;
    case "choose": return `Pick ${value} in ${where}.`;
    case "check":
      if (step.blank) return `Tick ${where} when ${demoBlankMark(step.blank)} is yes, and clear it otherwise.`;
      return step.checked === false ? `Clear ${where}.` : `Tick ${where}.`;
    case "press": return `Press ${step.key ?? "Enter"} in ${where}.`;
    case "upload": return `Attach the file ${value} to ${where}.`;
    case "sign-in": return `Sign in to ${step.site ?? "the site"} with the saved login from the Vault (fill_login). Never type a password yourself.`;
    case "protected": return `Ask the person to fill ${where}: it is private and was not recorded.`;
  }
}

/** The kind of blank a step's value makes. */
export function demoBlankKindOf(step: DemoStep): DemoBlankKind {
  if (step.kind === "upload") return "file";
  if (step.kind === "check") return "toggle";
  if (step.kind === "select" || step.kind === "choose") return "choice";
  return "text";
}

/** Whether a step carries a value that can become a blank. */
export function demoStepHasValue(step: DemoStep): boolean {
  return step.kind === "fill" || step.kind === "select" || step.kind === "choose" || step.kind === "upload" || step.kind === "check";
}

/** The blanks a list of steps uses, in first-use order, with each step's label and example. */
export function demoBlanksOf(steps: readonly DemoStep[]): DemoBlank[] {
  const blanks = new Map<string, DemoBlank>();
  for (const step of steps) {
    if (!step.blank || !demoStepHasValue(step) || blanks.has(step.blank)) continue;
    const label = step.target?.name || step.target?.label || step.target?.placeholder || step.blank;
    const example = step.kind === "check" ? (step.checked === false ? "no" : "yes") : step.value ?? "";
    blanks.set(step.blank, { name: step.blank, label, example, kind: demoBlankKindOf(step) });
  }
  return [...blanks.values()];
}
