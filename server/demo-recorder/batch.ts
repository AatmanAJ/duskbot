import type { DemoRecording } from "../../shared/demo-recording.ts";
import type { InputRecord } from "./inputs.ts";
import type { DemoPagePort } from "./ports.ts";
import type { ReplayDeps, ReplayOutcome } from "./replay.ts";

export interface BatchItem {
  source: string;
  ok: boolean;
  /** Why this record was not run to the end. */
  text: string;
  outcome?: ReplayOutcome;
}

export interface BatchOutcome {
  ok: boolean;
  items: BatchItem[];
  /** The records after the one that stopped the batch. */
  notRun: string[];
  /** What the bot is told. */
  text: string;
}

export interface BatchDeps extends Omit<ReplayDeps, "resolveFile" | "fromStep"> {
  /** The full path of a file a record names, relative to the record's own folder, or null when the bot may not read it. */
  resolveFile?(value: string, record: InputRecord): string | null;
}

/** Runs the recording once for each record, in order, and stops at the first one the page did not take. */
export function replayBatch(_port: DemoPagePort, _recording: DemoRecording, _records: readonly InputRecord[], _deps: BatchDeps = {}): Promise<BatchOutcome> {
  throw new Error("not built");
}
