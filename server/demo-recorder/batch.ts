// The same recording once for each input record: "do the other eleven from this folder".
import { existsSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import type { DemoRecording } from "../../shared/demo-recording.ts";
import { matchInputs, type InputRecord } from "./inputs.ts";
import type { DemoPagePort } from "./ports.ts";
import { replayDemo, type ReplayDeps, type ReplayOutcome } from "./replay.ts";
import { DEMO_REPLAY_TOOL } from "./skill-file.ts";

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
  /** Asked before each record: false leaves it and the rest for another call, as when the call's time is used up. */
  goOn?(): boolean;
}

/** A file a record names, kept inside the record's own folder. */
function besideRecord(value: string, record: InputRecord): string | null {
  if (!record.folder) return null;
  const path = resolve(record.folder, value);
  const away = relative(record.folder, path);
  return !away || away === ".." || away.startsWith(`..${sep}`) ? null : path;
}

/** Runs the recording once for each record, in order, and stops at the first one the page did not take. */
export async function replayBatch(port: DemoPagePort, recording: DemoRecording, records: readonly InputRecord[], deps: BatchDeps = {}): Promise<BatchOutcome> {
  const { resolveFile = besideRecord, goOn, ...replayDeps } = deps;
  const fileBlanks = recording.blanks.filter((blank) => blank.kind === "file").map((blank) => blank.name);
  const items: BatchItem[] = [];
  let notRun: string[] = [];
  for (let at = 0; at < records.length; at++) {
    const record = records[at]!;
    deps.checkpoint?.();
    if (items.length && goOn && !goOn()) {
      notRun = records.slice(at).map((later) => later.source);
      break;
    }
    const { inputs, missing } = matchInputs(recording.blanks, record);
    if (missing.length) {
      items.push({ source: record.source, ok: false, text: `${record.source} has no value for ${missing.map((name) => `\`${name}\``).join(", ")}, so it was not started.` });
      continue;
    }
    const unreadable = fileBlanks.find((name) => {
      const path = resolveFile(inputs[name]!, record);
      let isFile = false;
      try { isFile = path !== null && existsSync(path) && statSync(path).isFile(); } catch {}
      if (isFile) inputs[name] = path!;
      return !isFile;
    });
    if (unreadable) {
      items.push({ source: record.source, ok: false, text: `${record.source} names a file for \`${unreadable}\` that is missing or outside the folders you may read, so it was not started.` });
      continue;
    }
    const outcome = await replayDemo(port, recording, inputs, { ...replayDeps, resolveFile: (value) => value });
    items.push({ source: record.source, ok: outcome.ok, text: outcome.ok ? "Done." : outcome.text, outcome });
    if (!outcome.ok) {
      notRun = records.slice(at + 1).map((later) => later.source);
      break;
    }
  }
  const done = items.filter((item) => item.ok);
  const failed = items.filter((item) => !item.ok);
  const lines = [`Ran "${recording.title}" for ${done.length} of ${records.length} ${records.length === 1 ? "record" : "records"}${done.length ? `: ${done.map((item) => item.source).join(", ")}` : ""}.`];
  for (const item of failed) lines.push("", `${item.source}:`, item.text);
  const stopped = items.at(-1)?.ok === false ? items.at(-1)!.source : null;
  if (notRun.length) lines.push("", `Not started: ${notRun.join(", ")}. ${stopped ? `Once ${stopped} is finished, call` : "Call"} ${DEMO_REPLAY_TOOL} again for these.`);
  if (!failed.length) lines.push("Read the page to confirm the last result before you report it.");
  return { ok: failed.length === 0 && notRun.length === 0, items, notRun, text: lines.join("\n") };
}
