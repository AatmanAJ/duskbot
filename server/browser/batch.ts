// agent_browser_batch: a list of browser steps run in one tool call, each through the same tool code a single call uses.
import { isUnanswered } from "./cdp/errors.ts";
import { PersonHoldAnswer } from "../browser-refusals.ts";
import { BROWSER_CONTROL_REFUSAL } from "./control.ts";
import type { ToolContext } from "./dispatch.ts";
import { errorResult, type Content, type ToolResult } from "./shape.ts";
import { batchStepCall, MAX_BATCH_MS, type BATCH_TOOL, type BatchStep, type ToolCall, type ToolInput } from "./tools.ts";

/** The whole answer's text, so 200 steps cannot fill the conversation. */
export const BATCH_TEXT_CHARS = 60_000;
const ACTION_TEXT_CHARS = 2_000;
const READ_TEXT_CHARS = 22_000;
/** A step is not started with less than this left: it would only time out. */
const STEP_FLOOR_MS = 1_000;

export interface BatchDeps {
  execute(context: ToolContext, call: ToolCall): Promise<ToolResult>;
  /** A thrown error as the step's answer; null for one the service must handle itself. */
  failure(error: unknown): ToolResult | null;
}

/** What a batch needs of an engine: each step through that engine's own single-call path. */
export interface StepRunner<Call> {
  /** No step starts past this, and none starts with less than a second left. */
  readonly deadline: number;
  readonly limitMs: number;
  /** One step as its engine's tool call, checked against that tool's schema. */
  parse(step: BatchStepOf): { ok: true; call: Call } | { ok: false; error: string };
  execute(call: Call, deadline: number): Promise<ToolResult>;
  /** A thrown error as the step's answer; null for one the engine must handle itself. */
  failure(error: unknown): ToolResult | null;
  /** The page's snapshot after a failure, or null when it cannot be read now. */
  pageAfter(): Promise<ToolResult | null>;
  /** Throws once the call may no longer act; asked before each later step. */
  checkpoint?(): void;
}

/** A step as the bot wrote it: the tool's name without agent_browser_, and that tool's own arguments. */
export type BatchStepOf = { do: string } & Record<string, unknown>;

/** Steps whose answer is the page's content and so gets more room than an action's. */
const READ_STEPS: ReadonlySet<string> = new Set(["read", "snapshot", "get_text"]);

type Ending = { kind: "done" } | { kind: "failed"; step: number } | { kind: "person"; step: number; answer: string } | { kind: "time"; step: number };

const seconds = (ms: number) => `${(ms / 1_000).toFixed(1)} s`;

function clip(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, chars)}… (cut at ${chars} characters)`;
}

function headline(ending: Ending, total: number, elapsedMs: number, limitMs: number): string {
  switch (ending.kind) {
    case "done":
      return `Ran all ${total} step${total === 1 ? "" : "s"} in ${seconds(elapsedMs)}.`;
    case "failed":
      return `Step ${ending.step} of ${total} failed, so ${total - ending.step === 0 ? "it was the last" : `the ${total - ending.step} after it did not run`}. The ${ending.step - 1} before it ran.`;
    case "person":
      return `A person took control of the browser at step ${ending.step} of ${total}, so the steps after it did not run. Step ${ending.step} may already have taken effect: check the page before repeating it.`;
    case "time":
      return `The batch reached its ${seconds(limitMs)} limit before step ${ending.step} of ${total}; it and the steps after it did not run.`;
  }
}

export function runBatch(context: ToolContext, input: ToolInput<typeof BATCH_TOOL>, deps: BatchDeps): Promise<ToolResult> {
  const limitMs = input.timeoutMs ?? MAX_BATCH_MS;
  const deadline = Math.min(context.deadline, Date.now() + limitMs);
  const stepContext: ToolContext = { ...context, deadline };
  return runSteps(input.steps, {
    deadline, limitMs,
    parse: (step) => batchStepCall(step as BatchStep),
    execute: (call) => deps.execute(stepContext, call),
    failure: deps.failure,
    pageAfter: () => deps.execute(context, { name: "agent_browser_snapshot", input: {} }),
    ...(context.checkpoint ? { checkpoint: () => context.checkpoint?.() } : {}),
  });
}

export async function runSteps<Call>(steps: readonly BatchStepOf[], runner: StepRunner<Call>): Promise<ToolResult> {
  const started = Date.now();
  const { deadline, limitMs } = runner;
  const parts: Content[] = [];
  let chars = 0;
  const leftOut: number[] = [];
  let ending: Ending = { kind: "done" };
  for (const [index, step] of steps.entries()) {
    const number = index + 1;
    if (index > 0) runner.checkpoint?.();
    if (deadline - Date.now() < STEP_FLOOR_MS) { ending = { kind: "time", step: number }; break; }
    const parsed = runner.parse(step);
    let result: ToolResult;
    if (!parsed.ok) {
      result = errorResult(parsed.error);
    } else {
      try {
        result = await runner.execute(parsed.call, deadline);
      } catch (error) {
        if (isUnanswered(error)) throw error;
        if (error instanceof PersonHoldAnswer || (error instanceof Error && error.message === BROWSER_CONTROL_REFUSAL)) { ending = { kind: "person", step: number, answer: error.message }; break; }
        const failure = runner.failure(error);
        if (!failure) throw error;
        result = failure;
      }
    }
    const text = result.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
    const room = Math.min(READ_STEPS.has(step.do) ? READ_TEXT_CHARS : ACTION_TEXT_CHARS, BATCH_TEXT_CHARS - chars);
    if (room > 0 || result.isError) {
      const shown = clip(text, Math.max(room, ACTION_TEXT_CHARS));
      chars += shown.length;
      parts.push({ type: "text", text: `${number}. ${step.do}${result.isError ? " failed" : ""}: ${shown}` });
    } else {
      leftOut.push(number);
    }
    parts.push(...result.content.filter((part) => part.type === "image"));
    if (result.isError) { ending = { kind: "failed", step: number }; break; }
  }
  if (leftOut.length) parts.push({ type: "text", text: `The answers of ${leftOut.length} later step${leftOut.length === 1 ? "" : "s"} (${leftOut[0]} to ${leftOut.at(-1)}) were left out: the batch's answers reached ${BATCH_TEXT_CHARS} characters.` });
  const lead: Content = { type: "text", text: headline(ending, steps.length, Date.now() - started, limitMs) };
  if (ending.kind === "done") return { content: [lead, ...parts] };
  if (ending.kind === "person") return { isError: true, content: [lead, ...parts, { type: "text", text: ending.answer }] };
  return { isError: true, content: [lead, ...parts, ...await pageAfter(runner)] };
}

/** The page as the batch left it, so the next call can go on from its refs. */
async function pageAfter(runner: StepRunner<unknown>): Promise<Content[]> {
  try {
    const snapshot = await runner.pageAfter();
    if (!snapshot || snapshot.isError) return [];
    const text = snapshot.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
    return [{ type: "text", text: `The page now:\n${clip(text, READ_TEXT_CHARS)}` }];
  } catch (error) {
    if (isUnanswered(error)) throw error;
    return [];
  }
}
