import type { DemoAction, DemoBlank, DemoBlankKind, DemoCheck, DemoPlan, DemoStep } from "./demo-recording.ts";

export const BLANK_NAME = /^[a-z][a-z0-9_]{0,39}$/;

const BLANK_USE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const BLANK_KINDS: readonly DemoBlankKind[] = ["text", "number", "date", "choice", "secret"];
const LIMITS = { steps: 200, blanks: 60, actions: 60, text: 2_000, title: 160, choices: 200 } as const;

/** The blanks a piece of text names, in order, once each. */
export function blankNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(BLANK_USE)) {
    if (!names.includes(match[1]!)) names.push(match[1]!);
  }
  return names;
}

/** Text with each {{name}} replaced by its value; a blank with no value stays as written. */
export function fillBlanks(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(BLANK_USE, (written, name: string) => (Object.hasOwn(values, name) ? values[name]! : written));
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Whether `text` holds `pattern`, where * stands for anything, ignoring case and spacing. */
export function matchesPattern(pattern: string, text: string): boolean {
  const parts = squash(pattern).split("*").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) return false;
  const within = squash(text);
  let from = 0;
  for (const part of parts) {
    const at = within.indexOf(part, from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

/** A name a blank may have, made from a field's label. */
export function blankNameFrom(label: string, taken: ReadonlySet<string>): string {
  const words = label.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  const base = (/^[a-z]/.test(words) ? words : `value_${words}`).replace(/_+$/g, "").slice(0, 32) || "value";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  }
}

function mapText(plan: DemoPlan, change: (text: string) => string): DemoPlan {
  const action = (each: DemoAction): DemoAction => ("value" in each ? { ...each, value: change(each.value) } : each);
  const check = (each: DemoCheck): DemoCheck => {
    if (each.kind === "field") return { ...each, value: change(each.value) };
    if (each.kind === "visual") return { ...each, expect: change(each.expect) };
    return { ...each, text: change(each.text) };
  };
  return { ...plan, steps: plan.steps.map((step) => ({ ...step, goal: change(step.goal), actions: step.actions.map(action), check: check(step.check) })) };
}

function usedBlanks(step: Pick<DemoStep, "goal" | "actions" | "check">): string[] {
  const texts = [step.goal, ...step.actions.map((action) => ("value" in action ? action.value : "")), step.check.kind === "field" ? step.check.value : step.check.kind === "visual" ? step.check.expect : step.check.text];
  return blankNames(texts.join("\n"));
}

export function renameBlank(plan: DemoPlan, from: string, to: string): DemoPlan | { error: string } {
  if (!plan.blanks.some((blank) => blank.name === from)) return { error: `There is no input called ${from}.` };
  if (!BLANK_NAME.test(to)) return { error: "An input's name is lowercase letters, digits and underscores, starting with a letter." };
  if (to !== from && plan.blanks.some((blank) => blank.name === to)) return { error: `Another input is already called ${to}.` };
  const renamed = mapText(plan, (text) => text.replace(BLANK_USE, (written, name: string) => (name === from ? `{{${to}}}` : written)));
  return { ...renamed, blanks: plan.blanks.map((blank) => (blank.name === from ? { ...blank, name: to } : blank)) };
}

/** Makes a blank a fixed value: every {{name}} becomes the value and the blank goes. */
export function fixBlank(plan: DemoPlan, name: string, value: string): DemoPlan | { error: string } {
  const blank = plan.blanks.find((each) => each.name === name);
  if (!blank) return { error: `There is no input called ${name}.` };
  if (blank.kind === "secret") return { error: "A secret cannot be written into the steps." };
  const fixed = mapText(plan, (text) => text.replace(BLANK_USE, (written, used: string) => (used === name ? value : written)));
  return { ...fixed, blanks: plan.blanks.filter((each) => each.name !== name) };
}

export function moveStep(plan: DemoPlan, stepId: string, toIndex: number): DemoPlan {
  const from = plan.steps.findIndex((step) => step.id === stepId);
  if (from < 0) return plan;
  const steps = [...plan.steps];
  const [step] = steps.splice(from, 1);
  steps.splice(Math.max(0, Math.min(steps.length, Math.trunc(toIndex))), 0, step!);
  return { ...plan, steps };
}

export function removeStep(plan: DemoPlan, stepId: string): DemoPlan {
  return { ...plan, steps: plan.steps.filter((step) => step.id !== stepId) };
}

export function updateStep(plan: DemoPlan, stepId: string, patch: Partial<Pick<DemoStep, "title" | "goal" | "check">>): DemoPlan | { error: string } {
  const step = plan.steps.find((each) => each.id === stepId);
  if (!step) return { error: "That step is not in the plan." };
  const next: DemoStep = { ...step, ...(patch.title !== undefined ? { title: patch.title.trim() } : {}), ...(patch.goal !== undefined ? { goal: patch.goal.trim() } : {}), ...(patch.check !== undefined ? { check: patch.check } : {}) };
  if (!next.title) return { error: "A step needs a title." };
  if (!next.goal) return { error: "A step needs a goal." };
  const check = readCheck(next.check);
  if (!check) return { error: "A step needs a check." };
  const known = new Set(plan.blanks.map((blank) => blank.name));
  const stray = usedBlanks({ ...next, check }).find((name) => !known.has(name));
  if (stray) return { error: `There is no input called ${stray}.` };
  return { ...plan, steps: plan.steps.map((each) => (each.id === stepId ? { ...next, check } : each)) };
}

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
const text = (value: unknown, limit: number = LIMITS.text): string | null => (typeof value === "string" && value.length <= limit ? value : null);
const filled = (value: unknown, limit: number = LIMITS.text): string | null => {
  const read = text(value, limit);
  return read !== null && read.trim().length > 0 ? read : null;
};

/** A check as written by a person or a model, or null when it is not one. */
export function readCheck(value: unknown): DemoCheck | null {
  const check = record(value);
  if (!check) return null;
  if (check.kind === "text" || check.kind === "title" || check.kind === "url") {
    const pattern = filled(check.text);
    return pattern === null ? null : { kind: check.kind, text: pattern };
  }
  if (check.kind === "field") {
    const role = filled(check.role, 60);
    const name = filled(check.name, 300);
    const wanted = text(check.value);
    return role === null || name === null || wanted === null ? null : { kind: "field", role, name, value: wanted };
  }
  if (check.kind === "visual") {
    const expect = filled(check.expect);
    return expect === null ? null : { kind: "visual", expect };
  }
  return null;
}

function readAction(value: unknown): DemoAction | null {
  const action = record(value);
  if (!action) return null;
  if (action.do === "open") {
    const url = filled(action.url);
    return url === null ? null : { do: "open", url };
  }
  if (action.do === "press") {
    const key = filled(action.key, 60);
    return key === null ? null : { do: "press", key };
  }
  const role = filled(action.role, 60);
  const name = filled(action.name, 300);
  if (role === null || name === null) return null;
  if (action.do === "click") return { do: "click", role, name };
  if (action.do === "fill" || action.do === "choose") {
    const wanted = text(action.value);
    return wanted === null ? null : { do: action.do, role, name, value: wanted };
  }
  return null;
}

function readBlank(value: unknown): DemoBlank | null {
  const blank = record(value);
  if (!blank) return null;
  const name = typeof blank.name === "string" && BLANK_NAME.test(blank.name) ? blank.name : null;
  const label = filled(blank.label, 300);
  const kind = BLANK_KINDS.find((each) => each === blank.kind);
  if (name === null || label === null || !kind) return null;
  const example = kind === "secret" ? null : text(blank.example);
  const choices = Array.isArray(blank.choices) ? blank.choices.filter((choice): choice is string => typeof choice === "string" && choice.length <= 300).slice(0, LIMITS.choices) : null;
  return { name, label, kind, ...(example !== null ? { example } : {}), ...(choices && choices.length ? { choices } : {}) };
}

function readStep(value: unknown): DemoStep | null {
  const step = record(value);
  if (!step) return null;
  const id = filled(step.id, 80);
  const title = filled(step.title, LIMITS.title);
  const goal = filled(step.goal);
  const check = readCheck(step.check);
  if (id === null || title === null || goal === null || !check || !Array.isArray(step.actions) || step.actions.length > LIMITS.actions) return null;
  const actions = step.actions.map(readAction);
  if (actions.some((action) => action === null)) return null;
  const point = record(step.point);
  const frame = filled(step.frame, 120);
  return {
    id,
    title: title.trim(),
    goal: goal.trim(),
    actions: actions as DemoAction[],
    check,
    ...(frame !== null && /^[\w-]+$/.test(frame) ? { frame } : {}),
    ...(point && typeof point.x === "number" && typeof point.y === "number" && Number.isFinite(point.x) && Number.isFinite(point.y) ? { point: { x: point.x, y: point.y } } : {}),
    events: Array.isArray(step.events) ? step.events.filter((seq): seq is number => Number.isInteger(seq) && seq > 0).slice(0, 2_000) : [],
  };
}

/** A plan as it may be saved: known shapes only, every blank a step names declared, every step with a goal and a check. */
export function validatePlan(value: unknown): { plan: DemoPlan } | { error: string } {
  const plan = record(value);
  if (!plan) return { error: "That is not a plan." };
  const title = filled(plan.title, LIMITS.title);
  if (title === null) return { error: "A plan needs a title." };
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) return { error: "A plan needs at least one step." };
  if (plan.steps.length > LIMITS.steps) return { error: "That plan has too many steps." };
  if (plan.blanks !== undefined && (!Array.isArray(plan.blanks) || plan.blanks.length > LIMITS.blanks)) return { error: "That plan's inputs cannot be read." };
  const blanks = (plan.blanks as unknown[] | undefined ?? []).map(readBlank);
  if (blanks.some((blank) => blank === null)) return { error: "One of the plan's inputs cannot be read." };
  const names = new Set<string>();
  for (const blank of blanks as DemoBlank[]) {
    if (names.has(blank.name)) return { error: `Two inputs are called ${blank.name}.` };
    names.add(blank.name);
  }
  const steps: DemoStep[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of plan.steps.entries()) {
    const step = readStep(raw);
    if (!step) return { error: `Step ${index + 1} needs a title, a goal, a check and actions the app knows.` };
    if (ids.has(step.id)) return { error: `Two steps share the id ${step.id}.` };
    ids.add(step.id);
    const stray = usedBlanks(step).find((name) => !names.has(name));
    if (stray) return { error: `Step ${index + 1} names an input that does not exist: ${stray}.` };
    steps.push(step);
  }
  return {
    plan: {
      title: title.trim(),
      summary: (text(plan.summary) ?? "").trim(),
      blanks: blanks as DemoBlank[],
      steps,
      compiledBy: plan.compiledBy === "engine" ? "engine" : "outline",
    },
  };
}
