import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";
import { MAX_FORGET_NOTES, NOTE_ID, USAGE_RETENTION_DAYS, type UsageForget, type UsageReport } from "../shared/usage-signals.ts";

export type SharedNoteKind = "bad" | "big" | "weekly";
export interface SharedNote { id: string; kind: SharedNoteKind; at: number; text: string | null }
export type SharedCountKind = "turns" | "runs" | "setup" | "events";
export interface SharedCount { kind: SharedCountKind; count: number; last: number; names?: string[] }
export interface SharedList { notes: SharedNote[]; counts: SharedCount[]; removing: boolean }

const DAY = 86_400_000, MAX_NOTES = 500, MAX_QUEUE = 5000, MAX_NAMES = 30;
const COUNT_KINDS: readonly SharedCountKind[] = ["turns", "runs", "setup", "events"];

/** what this workspace sent the account service, kept here (0600) for "see what's been shared": the notes as sent and
 * how many usage records of each kind, for USAGE_RETENTION_DAYS like the service keeps them. Deleting clears it here at
 * once and queues the note ids for the account service, which stores notes under a hash of the id and no account, so
 * these ids are the only way back to them; the queue survives a restart until a delete got through. */
export function createSharedLog(options: { file?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let notes: SharedNote[] = [], counts: SharedCount[] = [], queue: string[] = [], records = false;
  try {
    if (options.file) {
      const saved = JSON.parse(readFileSync(options.file, "utf8")) as Record<string, unknown>;
      if (Array.isArray(saved.notes)) notes = saved.notes.filter(isNote).slice(0, MAX_NOTES);
      if (Array.isArray(saved.counts)) counts = saved.counts.filter(isCount);
      if (Array.isArray(saved.queue)) queue = saved.queue.filter((id): id is string => typeof id === "string" && NOTE_ID.test(id)).slice(-MAX_QUEUE);
      records = saved.records === true;
    }
  } catch {}
  const save = () => {
    if (!options.file) return;
    try { writeFileAtomic(options.file, JSON.stringify({ notes, counts, queue, ...(records ? { records } : {}) }), { mode: 0o600, durable: false }); } catch {}
  };
  const prune = () => {
    const cutoff = now() - USAGE_RETENTION_DAYS * DAY;
    notes = notes.filter(note => note.at >= cutoff);
    counts = counts.filter(row => row.last >= cutoff);
  };
  const bump = (kind: SharedCountKind, by: number, names: readonly string[] = []) => {
    if (by <= 0) return;
    const row = counts.find(item => item.kind === kind) ?? (counts.push({ kind, count: 0, last: 0 }), counts.at(-1)!);
    row.count += by; row.last = now();
    if (names.length) row.names = [...new Set([...(row.names ?? []), ...names])].slice(0, MAX_NAMES);
  };
  /** notes that reached the account service, by whatever path */
  function sentNotes(sent: Pick<UsageReport, "frustrations" | "sessions" | "digests">) {
    const fresh: SharedNote[] = [
      ...(sent.frustrations ?? []).map(note => ({ id: note.id, kind: "bad" as const, at: note.at, text: note.summary ?? null })),
      ...(sent.sessions ?? []).map(note => ({ id: note.id, kind: "big" as const, at: note.at, text: note.summary ?? null })),
      ...(sent.digests ?? []).map(note => ({ id: note.id, kind: "weekly" as const, at: note.at, text: note.summary })),
    ].filter(note => !notes.some(known => known.id === note.id));
    if (!fresh.length) return;
    notes = [...fresh, ...notes].sort((a, b) => b.at - a.at).slice(0, MAX_NOTES);
  }
  return {
    /** a report's usage section got through */
    sent(report: UsageReport) {
      prune();
      sentNotes(report);
      bump("turns", report.turns.length);
      bump("runs", report.runs.length);
      if (report.snapshot) bump("setup", 1);
      if (report.signals?.length) bump("events", report.signals.length, report.signals.map(signal => signal.name));
      save();
    },
    sentNotes(sent: Pick<UsageReport, "frustrations" | "sessions" | "digests">) { prune(); sentNotes(sent); save(); },
    list(): SharedList {
      prune();
      return { notes: notes.map(note => ({ ...note })), counts: COUNT_KINDS.flatMap(kind => counts.filter(row => row.kind === kind)).map(row => ({ ...row })), removing: queue.length > 0 || records };
    },
    /** clears the list here and queues the account service's delete; `records` asks for this workspace's usage records too */
    forget(scope: { records: boolean }) {
      queue = [...queue, ...notes.map(note => note.id).filter(id => !queue.includes(id))].slice(-MAX_QUEUE);
      notes = [];
      if (scope.records) { records = true; counts = []; }
      save();
    },
    /** the next delete to send, or null when nothing is owed */
    forgetting(): UsageForget | null {
      return queue.length || records ? { notes: queue.slice(0, MAX_FORGET_NOTES), records } : null;
    },
    /** a delete got through */
    forgotten(done: UsageForget) {
      const gone = new Set(done.notes);
      queue = queue.filter(id => !gone.has(id));
      if (done.records) records = false;
      save();
    },
  };
}
export type SharedLog = ReturnType<typeof createSharedLog>;

function isNote(value: unknown): value is SharedNote {
  const note = value as SharedNote | null;
  return !!note && typeof note === "object" && typeof note.id === "string" && NOTE_ID.test(note.id) && ["bad", "big", "weekly"].includes(note.kind)
    && Number.isSafeInteger(note.at) && (note.text === null || (typeof note.text === "string" && note.text.length <= 2000));
}
function isCount(value: unknown): value is SharedCount {
  const row = value as SharedCount | null;
  return !!row && typeof row === "object" && COUNT_KINDS.includes(row.kind) && Number.isSafeInteger(row.count) && Number.isSafeInteger(row.last)
    && (row.names === undefined || (Array.isArray(row.names) && row.names.every(name => typeof name === "string" && name.length <= 60)));
}
