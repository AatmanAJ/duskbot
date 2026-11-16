import type { DemoAccessibility, DemoAction, DemoPlan, DemoReplayItem, DemoReplayProgress, DemoReplayReport, DemoStep } from "../../shared/demo-recording.ts";

const todo = (): never => { throw new Error("not built"); };

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
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** Runs the plan once for each item: every step carried out, checked, and tried again when its check does not pass. */
export function runReplay(_options: ReplayOptions): Promise<DemoReplayReport> { return todo(); }

/** A check as a sentence, with this item's values. */
export function describeCheck(_check: DemoStep["check"], _values: Readonly<Record<string, string>>): string { return todo(); }
