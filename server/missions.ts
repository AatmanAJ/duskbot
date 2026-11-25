import { createHash } from "node:crypto";

import {
  emptyLaneCounts, missionStateOf, OPEN_LANE_STATES, type LaneFile, type LaneState, type MissionLane, type MissionMark, type MissionSpan, type MissionSummary,
  type MissionTag, type MissionView, type SpanState,
} from "../shared/mission.ts";
import type { DigestFiles } from "../shared/digest.ts";
import type { JobRead } from "./routes/jobs.ts";
import { needsInputQuestion } from "./runtime-coordinator.ts";
import { withDefault } from "./runtime/questions.ts";
import type { Assignment, AssignmentEvent, EventKind } from "./runtime/types.ts";

export interface LaneSource {
  tag: MissionTag;
  botId: string;
  botName: string;
  threadId: string;
  title: string;
  cwd?: string;
  job: JobRead;
  digests: ReadonlyArray<DigestFiles | undefined>;
}

const FILES_SHOWN = 60;
const MARKS_SHOWN = 400;

export function laneFiles(digests: ReadonlyArray<DigestFiles | undefined>): LaneFile[] {
  const files = new Map<string, LaneFile["change"]>();
  for (const digest of digests) {
    if (!digest) continue;
    for (const path of digest.added) files.set(path, "added");
    for (const path of digest.changed) if (files.get(path) !== "added") files.set(path, "changed");
    for (const path of digest.deleted) {
      if (files.get(path) === "added") files.delete(path);
      else files.set(path, "deleted");
    }
  }
  return [...files].slice(-FILES_SHOWN).map(([path, change]) => ({ path, change }));
}

const ended = (row: Assignment) => row.status === "completed" || row.status === "failed" || row.status === "cancelled";

export function laneState({ view, rows }: JobRead): LaneState {
  const lead = rows.find((row) => row.id === view.roots.at(-1));
  switch (view.state) {
    case "needs-input": return "needs-input";
    case "completed": return "done";
    case "stalled": return "failed";
    case "idle": return "idle";
    case "failed": return lead?.status === "cancelled" || lead?.outcome === "stopped" ? "stopped" : "failed";
    case "running": {
      if (view.conversation.busy) return "working";
      const roots = new Set(view.roots);
      return rows.some((row) => !roots.has(row.id) && !ended(row)) || lead?.status === "waiting" ? "waiting" : "queued";
    }
  }
}

const OUTCOME_WORDS: Partial<Record<NonNullable<Assignment["outcome"]>, string>> = {
  provider_error: "Its engine reported an error",
  stalled: "No sign of progress from its engine, so it was ended",
  budget: "It used up the work it may do in one go",
  denied: "A permission it needed was refused",
  interrupted: "A restart cut it off",
  stopped: "It was stopped",
};

const firstLine = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^error:\s*/i, "") ?? "";

export function splitAsk(reply: string): { said: string; question?: string; suggested?: string } {
  const asked = needsInputQuestion(reply);
  if (!asked) return { said: reply };
  const at = reply.search(/^[ \t]*needs input:/im);
  const { question, default: suggested } = withDefault(asked);
  return { said: at > 0 ? reply.slice(0, at).trim() : "", question, ...(suggested ? { suggested } : {}) };
}

function boardLane(source: LaneSource): MissionLane {
  const { view, rows } = source.job;
  const state = laneState(source.job);
  const roots = new Set(view.roots);
  const teammates = rows.filter((row) => !roots.has(row.id));
  const leads = rows.filter((row) => roots.has(row.id));
  const lastLead = leads.at(-1);
  const replied = view.nodes.filter((node) => roots.has(node.id) && node.result && node.status !== "failed" && node.status !== "cancelled").at(-1);
  const ask = replied?.result ? splitAsk(replied.result) : undefined;
  const question = view.needsInput[0]?.question ?? (state === "needs-input" ? ask?.question : undefined);
  const failure = state === "failed" && lastLead ? firstLine(lastLead.result) || (lastLead.outcome && OUTCOME_WORDS[lastLead.outcome]) : undefined;
  const started = leads.map((row) => row.startedAt).filter((at): at is number => at !== undefined);
  return {
    lane: source.tag.lane, botId: source.botId, botName: source.botName, threadId: source.threadId, title: source.title,
    state, reason: state === "idle" ? "Its first message has not gone out" : failure || (question ? `${source.botName} needs your answer` : view.reason),
    ...(question ? { question } : {}),
    ...(question && ask?.suggested ? { suggested: ask.suggested } : {}),
    ...(started.length ? { startedAt: Math.min(...started) } : {}),
    ...(!OPEN_LANE_STATES.has(state) && lastLead?.finishedAt !== undefined ? { finishedAt: lastLead.finishedAt } : {}),
    teammates: teammates.length, teammatesOpen: teammates.filter((row) => !ended(row)).length,
    ...(ask?.said ? { reply: ask.said } : {}),
    files: laneFiles(source.digests),
    ...(source.cwd ? { cwd: source.cwd } : {}),
    ...(source.tag.brief ? { brief: source.tag.brief } : {}),
  };
}

const STATE_AFTER: Partial<Record<EventKind, SpanState>> = {
  enqueued: "queued", admitted: "queued", held: "queued", resume_due: "queued", restart_reconciled: "queued",
  started: "working", woken: "working", continued: "working", answered: "working",
  waiting: "waiting", parked: "needs-input",
};
const ENDS: ReadonlySet<EventKind> = new Set(["settled", "refused", "cancelled"]);

const finalState = (row: Assignment): "done" | "failed" | "stopped" =>
  row.status === "completed" ? "done" : row.status === "cancelled" || row.outcome === "stopped" ? "stopped" : "failed";

export function spansOf(row: Assignment, events: readonly AssignmentEvent[], laneThreadId: string, botName: string): MissionSpan[] {
  const spans: MissionSpan[] = [];
  const base = {
    laneThreadId, assignmentId: row.id, ...(row.parentId ? { parentId: row.parentId } : {}), depth: row.depth, botId: row.assignee.botId, botName,
  };
  let open: MissionSpan | undefined;
  const close = (at: number) => {
    if (open) open.to = Math.max(open.from, at);
    open = undefined;
  };
  for (const event of events) {
    if (ENDS.has(event.kind) && ended(row)) {
      close(event.at);
      spans.push({ ...base, state: finalState(row), from: event.at, to: event.at });
      return spans;
    }
    const next = STATE_AFTER[event.kind];
    if (!next || next === open?.state) continue;
    close(event.at);
    open = { ...base, state: next, from: event.at };
    spans.push(open);
  }
  if (!spans.length) {
    open = { ...base, state: ended(row) ? finalState(row) : "queued", from: row.createdAt };
    spans.push(open);
  }
  if (ended(row)) {
    const at = row.finishedAt ?? row.lastActivityAt;
    close(at);
    spans.push({ ...base, state: finalState(row), from: at, to: at });
  }
  return spans;
}

function marksOf(row: Assignment, events: readonly AssignmentEvent[], laneThreadId: string, botName: string, root: boolean): MissionMark[] {
  const base = { laneThreadId, assignmentId: row.id, botName };
  const marks: MissionMark[] = [];
  const first = events[0];
  if (!root) marks.push({ ...base, at: first?.at ?? row.createdAt, kind: "handoff", detail: row.brief.slice(0, 200) });
  for (const event of events) {
    if (event.kind === "parked") marks.push({ ...base, at: event.at, kind: "asked", ...(row.question ? { detail: row.question.slice(0, 200) } : {}) });
    else if (event.kind === "answered") marks.push({ ...base, at: event.at, kind: "answered" });
    else if (event.kind === "stalled") marks.push({ ...base, at: event.at, kind: "stalled" });
    else if (ENDS.has(event.kind) && ended(row)) {
      const state = finalState(row);
      marks.push({ ...base, at: event.at, kind: state, ...(row.outcomeDetail ? { detail: row.outcomeDetail.slice(0, 200) } : {}) });
    }
  }
  return marks;
}

export function missionSummary(id: string, sources: readonly LaneSource[]): MissionSummary {
  const states = sources.map((source) => laneState(source.job));
  const counts = emptyLaneCounts();
  for (const state of states) counts[state] += 1;
  const finishes = sources.flatMap((source) => source.job.rows.map((row) => row.finishedAt)).filter((at): at is number => at !== undefined);
  const open = states.some((state) => OPEN_LANE_STATES.has(state));
  const first = sources[0]?.tag;
  return {
    id, title: first?.title ?? "Mission", launchedAt: Math.min(...sources.map((source) => source.tag.launchedAt)),
    state: missionStateOf(states), lanes: sources.length, counts,
    ...(!open && finishes.length ? { finishedAt: Math.max(...finishes) } : {}),
  };
}

export function missionView(id: string, sources: readonly LaneSource[], events: (assignmentId: string) => AssignmentEvent[],
  nameOf: (botId: string) => string, now: number): MissionView {
  const ordered = [...sources].sort((a, b) => a.tag.lane - b.tag.lane || a.threadId.localeCompare(b.threadId));
  const spans: MissionSpan[] = [];
  const marks: MissionMark[] = [];
  const logs: Array<[string, number]> = [];
  for (const source of ordered) {
    const roots = new Set(source.job.view.roots);
    for (const row of source.job.rows) {
      const log = events(row.id);
      logs.push([row.id, log.at(-1)?.id ?? 0]);
      const name = nameOf(row.assignee.botId);
      spans.push(...spansOf(row, log, source.threadId, name));
      marks.push(...marksOf(row, log, source.threadId, name, roots.has(row.id)));
    }
  }
  const board = ordered.map(boardLane);
  const summary = missionSummary(id, ordered);
  const version = createHash("sha256").update(JSON.stringify([
    summary.state, board.map((lane) => [lane.threadId, lane.title, lane.state, lane.reason, lane.teammatesOpen, lane.files.length]),
    ordered.map((source) => source.job.view.version), logs,
  ])).digest("base64url").slice(0, 16);
  return { ...summary, now, version, board, spans, marks: marks.sort((a, b) => a.at - b.at).slice(-MARKS_SHOWN) };
}
