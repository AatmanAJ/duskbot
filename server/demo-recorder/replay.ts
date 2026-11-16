// Runs a recording on the page in front. Each step's element is found again by its role and name, never by a place on
// screen; where the page no longer matches, the run stops and says what is left, so the bot's own browsing takes over.
// Security: a value is never typed into a field the page keeps private, and a sign-in is only ever done by the Vault.
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { demoStepSentence, demoTargetWords, type DemoRecording, type DemoStep } from "../../shared/demo-recording.ts";
import { demoUrl } from "./events.ts";
import {
  DEMO_PAGE_SCRIPT, demoActExpression, demoFindExpression, demoPageStateExpression, demoUnmarkExpression,
  type DemoFound, type DemoPageAction, type DemoPageState,
} from "./page-script.ts";
import type { DemoPagePort } from "./ports.ts";
import { DEMO_REPLAY_TOOL } from "./skill-file.ts";

/** This run's value for each blank, by name. */
export type DemoInputs = Record<string, string>;

export const DEMO_STEP_TIMEOUT_MS = 8_000;
const POLL_MS = 120;
/** How long a sign-in step waits for a page that draws its form late before taking the person as signed in already. */
const SIGN_IN_LOOK_MS = 1_500;

export interface ReplayDeps {
  /** Types the saved login for `site` into the page in front; the answer never holds a value. */
  signIn?(site: string): Promise<{ ok: boolean; text: string }>;
  /** The full path of a file a blank names, or null when the bot may not read it. */
  resolveFile?(value: string): string | null;
  /** The step to start at, by id: the steps before it are taken as done. */
  fromStep?: string;
  /** How long a step waits for its element to show. */
  stepTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Throws once the run may no longer act, such as when its turn ended. */
  checkpoint?(): void;
}

export interface ReplayOutcome {
  ok: boolean;
  /** The ids of the steps this run did. */
  done: string[];
  /** The step the run stopped at, and why, when the page no longer matched. */
  stoppedAt?: { step: DemoStep; index: number; reason: string; url: string };
  /** The steps still to do, stopped step first, as sentences with this run's values written in. */
  remaining: string[];
  /** What the bot is told. Never a secret. */
  text: string;
}

const YES = new Set(["yes", "y", "true", "1", "on"]);
const BROWSER_TOOLS = "agent_browser_snapshot, then agent_browser_click or agent_browser_fill";

function parsed<T>(answer: unknown): T | null {
  let value = answer;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" ? value as T : null;
}

/** A step as this run does it: the blank's value written in. */
function withValue(step: DemoStep, inputs: DemoInputs): DemoStep {
  if (!step.blank) return step;
  const { blank, ...rest } = step;
  const value = inputs[blank] ?? "";
  return step.kind === "check" ? { ...rest, checked: YES.has(value.trim().toLowerCase()) } : { ...rest, value };
}

type StepResult = { ok: true } | { ok: false; reason: string; private?: boolean };

/** Thrown by a port when the run may not go on at all (the person took the browser): it ends the run instead of stopping a step. */
export class ReplayInterrupted extends Error {}

class Run {
  readonly #port: DemoPagePort;
  readonly #deps: ReplayDeps;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #nonce = randomBytes(9).toString("hex");

  constructor(port: DemoPagePort, deps: ReplayDeps) {
    this.#port = port;
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#timeoutMs = deps.stepTimeoutMs ?? DEMO_STEP_TIMEOUT_MS;
  }

  async #evaluate<T>(expression: string): Promise<T | null> {
    try { return parsed<T>(await this.#port.evaluate(expression)); } catch { return null; }
  }

  /** The page as it is now, with the recorder's helpers put in when a new document has none. */
  async state(): Promise<DemoPageState | null> {
    let state = await this.#evaluate<DemoPageState>(demoPageStateExpression());
    if (state?.absent) {
      try { await this.#port.evaluate(DEMO_PAGE_SCRIPT); } catch { return null; }
      state = await this.#evaluate<DemoPageState>(demoPageStateExpression());
    }
    return state;
  }

  /** Waits out a page that is loading or on its way to the next one. */
  async settled(): Promise<DemoPageState | null> {
    const until = this.#now() + this.#timeoutMs;
    for (;;) {
      const state = await this.state();
      if (state?.ready && !state.absent) return state;
      if (this.#now() >= until) return state;
      await this.#sleep(POLL_MS);
    }
  }

  async url(): Promise<string> {
    return (await this.state())?.url ?? "";
  }

  async unmark(): Promise<void> {
    await this.#evaluate(demoUnmarkExpression(this.#nonce));
  }

  #act(action: DemoPageAction): Promise<{ ok?: boolean; typed?: boolean; value?: string; reason?: string } | null> {
    return this.#evaluate(demoActExpression(this.#nonce, action));
  }

  /** The step's one element, waited for until the page shows it; otherwise why it could not be acted on. */
  async #find(step: DemoStep): Promise<{ found: DemoFound } | { reason: string }> {
    const until = this.#now() + this.#timeoutMs;
    const words = demoTargetWords(step.target);
    let last: DemoFound | null = null;
    for (;;) {
      await this.state();
      last = await this.#evaluate<DemoFound>(demoFindExpression(step.target!, { kind: step.kind, nonce: this.#nonce, ...(step.value === undefined ? {} : { value: step.value }) }));
      const usable = last?.count === 1 && last.selector && last.option !== false && !last.disabled;
      if (usable) return { found: last! };
      if (this.#now() >= until) break;
      await this.#sleep(POLL_MS);
    }
    if (!last || last.count === 0) return { reason: `The page has no ${words.replace(/^the /u, "")}.` };
    if (last.count > 1) return { reason: `${last.count} elements on the page could be ${words}, so none was touched.` };
    if (last.option === false) return { reason: `${words[0]!.toUpperCase()}${words.slice(1)} has no option "${step.value ?? ""}".` };
    return { reason: `${words[0]!.toUpperCase()}${words.slice(1)} is switched off on the page.` };
  }

  async #signIn(step: DemoStep, next: DemoStep | undefined): Promise<StepResult> {
    const until = this.#now() + SIGN_IN_LOOK_MS;
    for (;;) {
      const state = await this.settled();
      if (state?.passwordField) break;
      const ahead = next?.target ? await this.#evaluate<DemoFound>(demoFindExpression(next.target, { kind: next.kind, nonce: this.#nonce, ...(next.value === undefined ? {} : { value: next.value }) })) : null;
      if (ahead?.count) {
        await this.unmark();
        return { ok: true };
      }
      if (this.#now() >= until) return { ok: true };
      await this.#sleep(POLL_MS);
    }
    const site = step.site ?? "the site";
    if (!this.#deps.signIn) return { ok: false, reason: `The page asks for a sign-in to ${site}. Call fill_login on it; with no saved login, call request_credential with credential_id "login".` };
    const answer = await this.#deps.signIn(site);
    if (!answer.ok) return { ok: false, reason: answer.text };
    await this.settled();
    return { ok: true };
  }

  async step(step: DemoStep, next: DemoStep | undefined): Promise<StepResult> {
    if (step.kind === "open") {
      const url = demoUrl(step.url);
      if (!url) return { ok: false, reason: "The step's address is not a web address, so nothing was opened." };
      try { await this.#port.open(url); } catch (error) { return { ok: false, reason: `The address did not open (${error instanceof Error ? error.message.slice(0, 160) : "the browser gave no reason"}).` }; }
      await this.settled();
      return { ok: true };
    }
    if (step.kind === "sign-in") return this.#signIn(step, next);
    if (step.kind === "protected" || !step.target) return { ok: false, reason: "This field is private and was never recorded, so it is left for a person.", private: true };

    const looked = await this.#find(step);
    if ("reason" in looked) return { ok: false, reason: looked.reason };
    this.#deps.checkpoint?.();
    const { found } = looked;
    const selector = found.selector!;
    try {
      if (found.sensitive && step.kind !== "click" && step.kind !== "press") {
        return { ok: false, reason: "The page keeps this field private, so nothing was typed into it.", private: true };
      }
      switch (step.kind) {
        case "click":
          await this.#port.click(selector);
          break;
        case "fill": {
          const value = step.value ?? "";
          const focused = await this.#act({ do: "focus" });
          if (!focused?.ok) return { ok: false, reason: "The field could not be focused." };
          if (focused.typed && value !== "") {
            await this.#port.insertText(value);
            const held = await this.#act({ do: "read" });
            if (held?.value !== value) await this.#act({ do: "set", value });
          } else {
            const set = await this.#act({ do: "set", value });
            if (!set?.ok) return { ok: false, reason: "The field did not take the value." };
          }
          const check = await this.#act({ do: "read" });
          if (check && check.ok && typeof check.value === "string" && check.value !== value) return { ok: false, reason: "The field changed what was typed into it, so check it before going on." };
          break;
        }
        case "select": {
          const chosen = await this.#act({ do: "select", value: step.value ?? "" });
          if (!chosen?.ok) return { ok: false, reason: `The list has no option "${step.value ?? ""}".` };
          break;
        }
        case "choose":
          if (!found.checked) await this.#port.click(selector);
          break;
        case "check":
          if (found.checked !== (step.checked !== false)) await this.#port.click(selector);
          break;
        case "press":
          await this.#act({ do: "focus" });
          await this.#port.press(step.key ?? "Enter");
          break;
        case "upload": {
          if (!this.#port.upload) return { ok: false, reason: "This browser cannot attach a file here. Attach it with agent_browser_upload." };
          await this.#port.upload(selector, [step.value ?? ""]);
          break;
        }
      }
    } catch (error) {
      if (error instanceof ReplayInterrupted) throw error;
      return { ok: false, reason: `The browser did not take the action (${error instanceof Error ? error.message.slice(0, 160) : "no reason given"}).` };
    } finally {
      await this.unmark();
    }
    await this.settled();
    return { ok: true };
  }
}

function resolveUploads(steps: readonly DemoStep[], deps: ReplayDeps): { steps: DemoStep[] } | { problem: string } {
  const resolved: DemoStep[] = [];
  for (const step of steps) {
    if (step.kind !== "upload") { resolved.push(step); continue; }
    const value = step.value ?? "";
    const path = deps.resolveFile ? deps.resolveFile(value) : isAbsolute(value) ? value : null;
    if (!path) return { problem: `The file for ${demoTargetWords(step.target)} cannot be read from here: give its full path, inside a folder you may read.` };
    let isFile = false;
    try { isFile = existsSync(path) && statSync(path).isFile(); } catch {}
    if (!isFile) return { problem: `There is no file at the path given for ${demoTargetWords(step.target)}.` };
    resolved.push({ ...step, value: path });
  }
  return { steps: resolved };
}

/** Runs a recording on the page in front, each step found again by its role and name, stopping where the page differs. */
export async function replayDemo(port: DemoPagePort, recording: DemoRecording, inputs: DemoInputs, deps: ReplayDeps = {}): Promise<ReplayOutcome> {
  const total = recording.steps.length;
  const start = deps.fromStep ? recording.steps.findIndex((step) => step.id === deps.fromStep) : 0;
  if (start < 0) {
    return { ok: false, done: [], remaining: [], text: `This skill has no step "${deps.fromStep}". Its steps are ${recording.steps.map((step) => step.id).join(", ")}.` };
  }
  const todo = recording.steps.slice(start);
  const missing = [...new Set(todo.map((step) => step.blank).filter((blank): blank is string => Boolean(blank) && !(blank! in inputs)))];
  const sentences = (from: number, privateAt = -1) => recording.steps.slice(from).map((step, at) =>
    demoStepSentence(at + from === privateAt ? { id: step.id, kind: "protected", target: step.target } : withValue(step, inputs)));
  if (missing.length) {
    return { ok: false, done: [], remaining: sentences(start), text: `Nothing was done: this run has no value for ${missing.map((name) => `\`${name}\``).join(", ")}. Pass every input, then call ${DEMO_REPLAY_TOOL} again.` };
  }
  const prepared = resolveUploads(todo.map((step) => withValue(step, inputs)), deps);
  if ("problem" in prepared) return { ok: false, done: [], remaining: sentences(start), text: `Nothing was done. ${prepared.problem}` };

  const run = new Run(port, deps);
  const done: string[] = [];
  for (let at = 0; at < prepared.steps.length; at++) {
    const index = start + at;
    const step = prepared.steps[at]!;
    deps.checkpoint?.();
    const result = await run.step(step, prepared.steps[at + 1]);
    if (result.ok) {
      done.push(step.id);
      continue;
    }
    const original = recording.steps[index]!;
    const remaining = sentences(index, result.private ? index : -1);
    const nextId = result.private || original.kind === "sign-in" ? original.id : recording.steps[index + 1]?.id;
    const url = await run.url();
    const after = original.kind === "sign-in"
      ? `Once the login is saved or you are signed in, call ${DEMO_REPLAY_TOOL} again with from_step "${original.id}".`
      : result.private
        ? `Ask the person to fill it (request_sign_in), then call ${DEMO_REPLAY_TOOL} again with from_step "${recording.steps[index + 1]?.id ?? original.id}".`
        : nextId
          ? `Do step ${index + 1} yourself with your browser tools (${BROWSER_TOOLS}), then call ${DEMO_REPLAY_TOOL} again with from_step "${nextId}" for the rest.`
          : `Do step ${index + 1} yourself with your browser tools (${BROWSER_TOOLS}); it is the last one, so then check the page shows the result.`;
    const text = [
      `Stopped at step ${index + 1} of ${total}: ${remaining[0]}`,
      result.reason,
      `${done.length ? `The ${done.length === 1 ? "step" : `${done.length} steps`} before it ${done.length === 1 ? "was" : "were"} done.` : "No step was done."} The page is ${url || "unknown"}.`,
      "Steps left:",
      ...remaining.map((sentence, n) => `${index + n + 1}. ${sentence}`),
      after,
    ].join("\n");
    const stopped: DemoStep = result.private ? { id: original.id, kind: "protected", ...(original.target ? { target: original.target } : {}) } : original;
    return { ok: false, done, stoppedAt: { step: stopped, index, reason: result.reason, url }, remaining, text };
  }
  return { ok: true, done, remaining: [], text: `Did ${done.length === total ? `all ${total} steps` : `steps ${start + 1} to ${total}`} of "${recording.title}". Read the page to confirm the result before you report it.` };
}
