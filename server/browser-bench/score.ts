import { GROUPS, type Group, type Verdict } from "./task.ts";

export interface LoggedCall { at: number; ms: number; name: string; args: Record<string, unknown>; isError: boolean; chars: number; images: number; text: string }

export interface Play {
  taskId: string;
  group: Group;
  pass: boolean;
  why: string;
  /** Tool calls the model made; a batch counts once. */
  steps: number;
  errors: number;
  /** Wall time of the whole play, model included. */
  ms: number;
  /** Characters of tool results the model read. */
  chars: number;
  failure: string | null;
  errorKinds: Record<string, number>;
  answer: string;
  calls: LoggedCall[];
  runError?: string;
}

const KINDS: Array<[string, RegExp]> = [
  ["stale ref", /no longer on the page|ref .* (?:is|was) stale|Take a fresh snapshot and use its ref|not a ref this tab/iu],
  ["not found", /No element matches|There is no tab|No option matches|could not be found/iu],
  ["ambiguous", /matches \d+ elements|strict mode violation/iu],
  ["covered", /is covered by/iu],
  ["not visible", /not visible|still moving|outside the page's viewport/iu],
  ["not editable", /not an enabled text field|not a <select>|not a checkbox|is disabled|Nothing is focused/iu],
  ["timeout", /timed? ?out|still running|is stuck|did not answer|Waited \d/iu],
  ["bad arguments", /got arguments it cannot use|ran nothing|Pass only one|Name the element/iu],
];

export function errorKind(text: string): string {
  return KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? "other error";
}

export function scorePlay(input: { taskId: string; group: Group; verdict: Verdict; calls: LoggedCall[]; ms: number; answer: string; runError?: string }): Play {
  const errorKinds: Record<string, number> = {};
  for (const call of input.calls.filter((c) => c.isError)) {
    const kind = errorKind(call.text);
    errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
  }
  const lastError = [...input.calls].reverse().find((call) => call.isError);
  const failure = input.verdict.pass ? null
    : input.runError ? `run: ${input.runError.slice(0, 120)}`
    : lastError ? `${errorKind(lastError.text)}: ${input.verdict.why}`
    : `wrong outcome: ${input.verdict.why}`;
  return {
    taskId: input.taskId, group: input.group, pass: input.verdict.pass, why: input.verdict.why,
    steps: input.calls.length, errors: input.calls.filter((call) => call.isError).length, ms: input.ms,
    chars: input.calls.reduce((sum, call) => sum + call.chars, 0), failure, errorKinds, answer: input.answer.slice(0, 2_000), calls: input.calls,
    ...(input.runError ? { runError: input.runError } : {}),
  };
}

export interface Line { plays: number; passed: number; successPct: number; meanSteps: number; meanSeconds: number; meanErrors: number; meanKChars: number }

function line(plays: Play[]): Line {
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;
  return {
    plays: plays.length,
    passed: plays.filter((play) => play.pass).length,
    successPct: plays.length ? Math.round((plays.filter((play) => play.pass).length / plays.length) * 100) : 0,
    meanSteps: round(mean(plays.map((play) => play.steps))),
    meanSeconds: round(mean(plays.map((play) => play.ms / 1_000))),
    meanErrors: round(mean(plays.map((play) => play.errors))),
    meanKChars: round(mean(plays.map((play) => play.chars / 1_000))),
  };
}

export interface Scorecard { all: Line; groups: Record<Group, Line>; tasks: Record<string, Line>; errorKinds: Record<string, number>; failures: Record<string, string[]> }

export function scorecard(plays: Play[]): Scorecard {
  const groups = Object.fromEntries(GROUPS.map((group) => [group, line(plays.filter((play) => play.group === group))])) as Record<Group, Line>;
  const ids = [...new Set(plays.map((play) => play.taskId))];
  const errorKinds: Record<string, number> = {};
  for (const play of plays) for (const [kind, count] of Object.entries(play.errorKinds)) errorKinds[kind] = (errorKinds[kind] ?? 0) + count;
  return {
    all: line(plays),
    groups,
    tasks: Object.fromEntries(ids.map((id) => [id, line(plays.filter((play) => play.taskId === id))])),
    errorKinds,
    failures: Object.fromEntries(ids.map((id) => [id, plays.filter((play) => play.taskId === id && play.failure).map((play) => play.failure!)]).filter(([, list]) => list.length)),
  };
}
