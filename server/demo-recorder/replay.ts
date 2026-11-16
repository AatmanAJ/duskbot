import type { DemoRecording, DemoStep } from "../../shared/demo-recording.ts";
import type { DemoPagePort } from "./ports.ts";

/** This run's value for each blank, by name. */
export type DemoInputs = Record<string, string>;

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

/** Runs a recording on the page in front, each step found again by its role and name, stopping where the page differs. */
export function replayDemo(_port: DemoPagePort, _recording: DemoRecording, _inputs: DemoInputs, _deps: ReplayDeps = {}): Promise<ReplayOutcome> {
  throw new Error("not built");
}
