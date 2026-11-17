import { blankNames, dayText, fillBlanks, matchesPattern } from "../../shared/demo-plan.ts";
import type { DemoAccessibility, DemoAction, DemoItemOutcome, DemoPlan, DemoReplayItem, DemoReplayProgress, DemoReplayReport, DemoStep, DemoStepOutcome } from "../../shared/demo-recording.ts";

/** What is on screen, as accessibility reads it. */
export interface Observation {
  title: string;
  url: string;
  texts: string[];
  fields: Array<{ role: string; name: string; value: string }>;
}

/** A screen a plan can be carried out on. */
export interface ReplaySurface {
  readonly accessibility: DemoAccessibility;
  /** Carries out one action, its blanks filled. Security: `secret` marks a value that must not be logged or echoed. */
  perform(action: DemoAction, options?: { secret?: boolean }): Promise<{ ok: true } | { ok: false; reason: string }>;
  observe(): Promise<Observation>;
}

export interface StepRequest {
  step: DemoStep;
  item: DemoReplayItem;
  /** The step's goal with this item's values. A secret blank reads as "the saved sign-in", never its value. */
  goal: string;
  /** How the step will be checked, in words. */
  check: string;
  /** Why the last try did not pass. */
  hint: string;
  attempt: number;
}

/** The bot's own computer use, asked to get one step done. */
export interface StepActor {
  attempt(request: StepRequest): Promise<{ ok: boolean; note?: string }>;
  /** Looks at the screen and says whether it shows what is expected: the only check there is without accessibility. */
  confirm?(expectation: string): Promise<boolean>;
}

export interface ReplayOptions {
  plan: DemoPlan;
  items: readonly DemoReplayItem[];
  surface: ReplaySurface;
  actor?: StepActor | null;
  /** The value of a secret blank, from the saved sign-ins. */
  secrets?: (blank: string) => Promise<string | null>;
  maxAttempts?: number;
  /** How long a check may take to come true after a step. */
  settleMs?: number;
  onProgress?: (progress: DemoReplayProgress) => void;
  /** A step that did not pass: the answer says to leave that file there, or to try the step once more. */
  onStuck?: (item: DemoReplayItem, outcome: DemoStepOutcome) => Promise<"skip" | "retry">;
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
}

const MAX_ATTEMPTS = 3;
const SETTLE_MS = 2_500;
const POLL_MS = 150;
const NOTE_LIMIT = 600;
const SAVED_SIGN_IN = "the saved sign-in";
const TEXT_ENTRY = new Set(["textbox", "searchbox", "spinbutton"]);

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const holds = (within: string, part: string) => squash(within).includes(squash(part));
const sameRole = (a: string, b: string) => a === b || (TEXT_ENTRY.has(a) && TEXT_ENTRY.has(b));
const sameName = (a: string, b: string) => squash(a) === squash(b);
const note = (text: string) => (text.length > NOTE_LIMIT ? `${text.slice(0, NOTE_LIMIT - 1)}…` : text);

/** A check as a sentence, with this item's values. */
export function describeCheck(check: DemoStep["check"], values: Readonly<Record<string, string>>): string {
  if (check.kind === "text") return `the screen shows "${fillBlanks(check.text, values)}"`;
  if (check.kind === "field") return `the ${check.role} "${check.name}" holds "${fillBlanks(check.value, values)}"`;
  if (check.kind === "title") return `the page or window is titled "${fillBlanks(check.text, values)}"`;
  if (check.kind === "url") return `the address contains ${fillBlanks(check.text, values)}`;
  return fillBlanks(check.expect, values);
}

const checkText = (check: DemoStep["check"]) => (check.kind === "field" ? check.value : check.kind === "visual" ? check.expect : check.text);

interface Verdict {
  ok: boolean;
  why: string;
  unchecked?: boolean;
  /** Nothing new came on screen either: the page may still be working on it. */
  quiet?: boolean;
}

/** Runs the plan once for each item: every step carried out, checked, and tried again when its check does not pass. */
export async function runReplay(options: ReplayOptions): Promise<DemoReplayReport> {
  const { plan, surface } = options;
  const actor = options.actor ?? null;
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? MAX_ATTEMPTS));
  const polls = Math.max(1, Math.ceil((options.settleMs ?? SETTLE_MS) / POLL_MS));
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const emit = (progress: DemoReplayProgress) => {
    try { options.onProgress?.(progress); } catch {}
  };
  const secretNames = new Set(plan.blanks.filter((blank) => blank.kind === "secret").map((blank) => blank.name));
  const neededNames = new Set(plan.steps.flatMap((step) => blankNames([step.goal, checkText(step.check), ...step.actions.map((action) => ("value" in action ? action.value : ""))].join("\n"))).filter((name) => !secretNames.has(name)));
  const secretsUsed = new Set<string>();
  // Security: asked again at every fill, so a saved sign-in is given for the page in front then, not the one a run began on.
  const secretOf = async (name: string): Promise<string | null> => {
    const value = options.secrets ? await options.secrets(name).catch(() => null) : null;
    if (value) secretsUsed.add(value);
    return value;
  };
  /** Security: what a run says about itself goes to the bot, the app and its log, so no secret it typed stays in it. */
  const hushed = (text: string) => [...secretsUsed].reduce((said, secret) => said.split(secret).join(SAVED_SIGN_IN), text);
  const stopped = () => options.signal?.aborted === true;
  const spoken = (values: Readonly<Record<string, string>>) => ({ ...Object.fromEntries([...secretNames].map((name) => [name, SAVED_SIGN_IN])), ...values });

  const blank = (step: DemoStep): DemoStepOutcome => ({ id: step.id, title: step.title, status: "not-run", attempts: 0 });

  async function strict(step: DemoStep, values: Readonly<Record<string, string>>): Promise<{ ok: boolean; seen: Observation | null; unchecked?: boolean }> {
    const { check } = step;
    if (check.kind === "visual") return { ok: false, seen: null, unchecked: true };
    let seen: Observation | null = null;
    for (let poll = 0; poll < polls; poll++) {
      if (poll > 0) await wait(POLL_MS);
      seen = await surface.observe().catch(() => null);
      if (!seen) continue;
      if (check.kind === "text" && seen.texts.some((text) => matchesPattern(fillBlanks(check.text, values), text))) return { ok: true, seen };
      if (check.kind === "title" && matchesPattern(fillBlanks(check.text, values), seen.title)) return { ok: true, seen };
      if (check.kind === "url" && matchesPattern(fillBlanks(check.text, values), seen.url)) return { ok: true, seen };
      if (check.kind === "field") {
        const field = seen.fields.find((each) => sameRole(each.role, check.role) && sameName(each.name, check.name));
        const secret = blankNames(check.value).some((name) => secretNames.has(name));
        const wanted = fillBlanks(check.value, values);
        if (field && (secret ? field.value.length > 0 : wanted.trim() === "" ? field.value.trim() === "" : matchesPattern(wanted, field.value))) return { ok: true, seen };
      }
    }
    return { ok: false, seen };
  }

  /** Whether every value the check speaks of can be seen somewhere on the screen. */
  function grounded(step: DemoStep, values: Readonly<Record<string, string>>, seen: Observation | null): boolean {
    const wanted = blankNames(checkText(step.check)).filter((name) => !secretNames.has(name)).map((name) => (Object.hasOwn(values, name) ? values[name]! : "")).filter((value) => value.trim().length > 0);
    if (!wanted.length) return true;
    if (!seen) return false;
    const shown = [seen.title, ...seen.texts, ...seen.fields.map((field) => field.value)];
    return wanted.every((value) => shown.some((text) => holds(text, value)));
  }

  async function verify(step: DemoStep, values: Readonly<Record<string, string>>, viaBot: boolean, before: ReadonlySet<string>): Promise<Verdict> {
    const said = describeCheck(step.check, spoken(values));
    if (step.check.kind === "visual") {
      if (actor?.confirm) return (await actor.confirm(said).catch(() => false)) ? { ok: true, why: "" } : { ok: false, why: `The bot looked and did not see it: ${said}` };
      return surface.accessibility === "none" ? { ok: false, why: "Only the bot can look at this screen, and no bot was given." } : { ok: true, why: "", unchecked: true };
    }
    const { ok, seen } = await strict(step, values);
    if (ok) return { ok: true, why: "" };
    if (viaBot && actor?.confirm && grounded(step, values, seen) && await actor.confirm(said).catch(() => false)) return { ok: true, why: "" };
    const fresh = (seen?.texts ?? []).filter((text) => !before.has(text));
    const check = step.check;
    const field = check.kind === "field" ? seen?.fields.find((each) => sameRole(each.role, check.role) && sameName(each.name, check.name)) : undefined;
    const found = check.kind !== "field" ? "" : field ? ` It holds "${blankNames(check.value).some((name) => secretNames.has(name)) ? "" : field.value}".` : ` There is no ${check.role} "${check.name}" on the screen.`;
    return { ok: false, quiet: fresh.length === 0, why: `The check did not hold: ${said}.${found}${fresh.length ? ` The screen says: ${fresh.join(" | ")}` : ""}` };
  }

  async function act(step: DemoStep, values: Readonly<Record<string, string>>): Promise<{ ok: true } | { ok: false; reason: string; needsBot?: boolean }> {
    for (const action of step.actions) {
      const used = "value" in action ? blankNames(action.value) : [];
      const secret = used.filter((name) => secretNames.has(name));
      const filled: Record<string, string> = { ...values };
      for (const name of secret) {
        const value = await secretOf(name);
        if (value === null) return { ok: false, reason: `This step needs ${SAVED_SIGN_IN} for this site; fill it with the sign-in tool.`, needsBot: true };
        filled[name] = value;
      }
      const ready = "value" in action ? { ...action, value: fillBlanks(action.value, filled) } : action.do === "open" ? { ...action, url: fillBlanks(action.url, values) } : action;
      const done = await surface.perform(ready, secret.length ? { secret: true } : undefined).catch(() => ({ ok: false as const, reason: "The screen could not be reached." }));
      if (!done.ok) return done;
    }
    return { ok: true };
  }

  async function runStep(step: DemoStep, item: DemoReplayItem): Promise<DemoStepOutcome> {
    const values = item.values;
    const said = spoken(values);
    const direct = surface.accessibility !== "none" && step.actions.length > 0;
    const before = new Set((direct || step.check.kind !== "visual" ? await surface.observe().catch(() => null) : null)?.texts ?? []);
    let hint = "";
    let via: "direct" | "bot" = direct ? "direct" : "bot";
    let botOnly = !direct;
    let attempts = 0;
    const pressesSomething = step.actions.some((action) => action.do === "click" || action.do === "press");
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (stopped()) return { id: step.id, title: step.title, status: "failed", via, attempts, note: note(hint || "Stopped.") };
      const useBot = botOnly || (attempt > 1 && actor !== null);
      if (useBot && !actor) {
        return { id: step.id, title: step.title, status: "failed", via, attempts, note: note(hint || "This step needs the bot: nothing here says what is on the screen, so only the bot can look and act.") };
      }
      attempts = attempt;
      if (useBot) {
        via = "bot";
        const tried = await actor!.attempt({ step, item, goal: fillBlanks(step.goal, said), check: describeCheck(step.check, said), hint, attempt }).catch(() => ({ ok: false, note: "The bot's turn did not finish." }));
        if (!tried.ok) {
          hint = hushed(tried.note?.trim() || "The bot could not do the step.");
          continue;
        }
      } else {
        via = "direct";
        const done = await act(step, values);
        if (!done.ok) {
          hint = hushed(done.reason);
          if (done.needsBot) botOnly = true;
          continue;
        }
      }
      let verdict = await verify(step, values, useBot, before);
      // A press that changed nothing yet is given as long again before it is pressed twice: a slow page is not sent a form two times.
      if (!verdict.ok && verdict.quiet && !useBot && pressesSomething) verdict = await verify(step, values, useBot, before);
      if (verdict.ok) return { id: step.id, title: step.title, status: "done", via, attempts, ...(verdict.unchecked ? { note: "Done, with nothing to check it against." } : {}) };
      hint = hushed(verdict.why);
    }
    return { id: step.id, title: step.title, status: "failed", via, attempts, note: note(hint) };
  }

  const outcomes: DemoItemOutcome[] = [];
  const todays = plan.blanks.filter((each) => each.today).map((each) => each.name);
  for (const [index, given] of options.items.entries()) {
    const day = dayText(new Date(options.now?.() ?? Date.now()));
    const item = todays.length ? { ...given, values: { ...given.values, ...Object.fromEntries(todays.map((name) => [name, day])) }, missing: given.missing.filter((name) => !todays.includes(name)) } : given;
    const steps = plan.steps.map(blank);
    if (options.signal?.aborted) {
      outcomes.push({ id: item.id, label: item.label, status: "skipped", steps });
      continue;
    }
    emit({ type: "item-start", item: item.id, index, total: options.items.length });
    const lacking = [...neededNames].filter((name) => item.missing.includes(name) || !Object.hasOwn(item.values, name));
    if (lacking.length) {
      outcomes.push({ id: item.id, label: item.label, status: "skipped", steps });
      emit({ type: "item-done", item: item.id, ok: false });
      continue;
    }
    let ok = true;
    let begun = true;
    let at = 0;
    while (at < plan.steps.length) {
      const step = plan.steps[at]!;
      if (stopped()) {
        ok = false;
        begun = at > 0;
        break;
      }
      emit({ type: "step-start", item: item.id, step: step.id });
      const outcome = await runStep(step, item);
      steps[at] = outcome;
      emit({ type: "step-done", item: item.id, step: step.id, ok: outcome.status === "done", via: outcome.via ?? "direct", attempts: outcome.attempts, ...(outcome.note ? { note: outcome.note } : {}) });
      if (outcome.status === "done") {
        at += 1;
        continue;
      }
      const decision = options.onStuck && !stopped() ? await options.onStuck(item, outcome).catch(() => "skip" as const) : "skip";
      if (decision === "retry" && !stopped()) continue;
      ok = false;
      options.log?.(`demo replay: item ${index + 1} of ${options.items.length} failed at step ${at + 1} of ${plan.steps.length}`);
      break;
    }
    outcomes.push({ id: item.id, label: item.label, status: ok ? "done" : begun ? "failed" : "skipped", steps });
    emit({ type: "item-done", item: item.id, ok });
  }
  return { items: outcomes, done: outcomes.filter((item) => item.status === "done").length, failed: outcomes.filter((item) => item.status === "failed").length };
}
