import { describe, expect, it } from "vitest";

import { missionStateOf, parseMissionTag } from "../shared/mission.ts";
import { jobView, type ConversationState } from "./job-view.ts";
import { laneFiles, laneState, missionSummary, missionView, spansOf, splitAsk, type LaneSource } from "./missions.ts";
import type { JobRead } from "./routes/jobs.ts";
import type { Assignment, AssignmentEvent, EventKind } from "./runtime/types.ts";

const row = (id: string, patch: Partial<Assignment> = {}): Assignment => ({
  id, rootId: patch.rootId ?? id, depth: 0, origin: { kind: "person", source: "chat" },
  requester: { kind: "person", threadId: "t-ada", botId: "ada" },
  assignee: { botId: "ada", destination: { kind: "standing_thread", threadId: "t-ada" } },
  mode: "work", reply: "resume", brief: "Map the competitors", status: "running", level: "full", levelSource: "own",
  executions: 1, restarts: 0, createdAt: 1_000, lastActivityAt: 1_000, result: "", rework: false, version: 1, ...patch,
});

let eventId = 0;
const log = (assignmentId: string, ...steps: Array<[EventKind, number]>): AssignmentEvent[] =>
  steps.map(([kind, at]) => ({ id: ++eventId, assignmentId, kind, at }));

const read = (threadId: string, rows: Assignment[], conversation: Partial<ConversationState> = {}): JobRead => ({
  rows,
  view: jobView({
    threadId, scope: "job", since: 0, now: 9_000, scopes: rows.filter((r) => !r.parentId).map((r) => r.id), rows,
    conversation: { kind: "bot", busy: false, queued: 0, ...conversation }, full: true,
    activityOf: () => undefined, nameOf: (botId) => ({ ada: "Ada", ben: "Ben", cy: "Cy" })[botId], titleOf: () => undefined,
    visible: () => true,
  }),
});

const lane = (lane: number, botId: string, job: JobRead): LaneSource => ({
  tag: { id: "m-launch", title: "Launch review", lane, launchedAt: 500 },
  botId, botName: botId.toUpperCase(), threadId: job.view.threadId, title: `Lane ${lane}`, job, digests: [],
});

describe("laneState", () => {
  it("reads a lane's state from its job: working, waiting on teammates, needs you, done, stopped, failed, idle", () => {
    expect(laneState(read("t", [row("r")], { busy: true }))).toBe("working");
    const child = row("c", { rootId: "r", parentId: "r", depth: 1, assignee: { botId: "ben", destination: { kind: "work_thread", threadId: "t-ben" } } });
    expect(laneState(read("t", [row("r", { status: "waiting" }), child]))).toBe("waiting");
    expect(laneState(read("t", [row("r", { status: "needs_input", question: "Which market first?" })]))).toBe("needs-input");
    expect(laneState(read("t", [row("r", { status: "completed", result: "Done" })]))).toBe("done");
    expect(laneState(read("t", [row("r", { status: "cancelled", outcome: "stopped" })]))).toBe("stopped");
    expect(laneState(read("t", [row("r", { status: "failed", outcome: "provider_error" })]))).toBe("failed");
    expect(laneState(read("t", []))).toBe("idle");
    expect(laneState(read("t", [], { queued: 1 }))).toBe("queued");
  });
});

describe("spansOf", () => {
  it("turns an assignment's log into stretches on one clock, ending in how it ended", () => {
    const r = row("r", { status: "completed", finishedAt: 4_000 });
    const spans = spansOf(r, log("r", ["enqueued", 1_000], ["admitted", 1_100], ["started", 1_200], ["progress", 1_500], ["waiting", 2_000],
      ["resume_due", 3_000], ["started", 3_100], ["settled", 4_000]), "t-ada", "Ada");
    expect(spans.map(({ state, from, to }) => [state, from, to])).toEqual([
      ["queued", 1_000, 1_200], ["working", 1_200, 2_000], ["waiting", 2_000, 3_000], ["queued", 3_000, 3_100], ["working", 3_100, 4_000],
      ["done", 4_000, 4_000],
    ]);
  });

  it("leaves the current stretch open while the work is, and parks on the person", () => {
    const spans = spansOf(row("r", { status: "needs_input" }), log("r", ["enqueued", 1_000], ["started", 1_100], ["parked", 1_900]), "t-ada", "Ada");
    expect(spans.at(-1)).toMatchObject({ state: "needs-input", from: 1_900 });
    expect(spans.at(-1)!.to).toBeUndefined();
  });

  it("still draws work whose log was pruned", () => {
    expect(spansOf(row("r"), [], "t-ada", "Ada")).toEqual([expect.objectContaining({ state: "queued", from: 1_000 })]);
    expect(spansOf(row("r", { status: "cancelled", finishedAt: 2_000 }), [], "t-ada", "Ada").map((span) => span.state)).toEqual(["stopped", "stopped"]);
  });
});

describe("missionView", () => {
  it("lays out a board in lane order, with each lane's reply, teammates, files and timeline", () => {
    const adaRoot = row("ra", { status: "waiting" });
    const benHelp = row("cb", { rootId: "ra", parentId: "ra", depth: 1, brief: "Price the three rivals",
      assignee: { botId: "ben", destination: { kind: "work_thread", threadId: "t-ben-help" } } });
    const cyRoot = row("rc", { status: "completed", result: "Here is the launch checklist.", startedAt: 1_020, finishedAt: 6_000,
      requester: { kind: "person", threadId: "t-cy", botId: "cy" }, assignee: { botId: "cy", destination: { kind: "standing_thread", threadId: "t-cy" } } });
    const events: Record<string, AssignmentEvent[]> = {
      ra: log("ra", ["enqueued", 1_000], ["started", 1_050], ["waiting", 2_000]),
      cb: log("cb", ["enqueued", 2_000], ["started", 2_100]),
      rc: log("rc", ["enqueued", 1_000], ["started", 1_020], ["settled", 6_000]),
    };
    const adaLane = { ...lane(0, "ada", read("t-ada", [adaRoot, benHelp])), digests: [{ added: ["notes/market.md"], changed: [], deleted: [] }] };
    const view = missionView("m-launch", [lane(1, "cy", read("t-cy", [cyRoot])), adaLane],
      (id) => events[id] ?? [], (botId) => ({ ada: "Ada", ben: "Ben", cy: "Cy" })[botId] ?? botId, 9_000);
    expect(view).toMatchObject({ id: "m-launch", title: "Launch review", launchedAt: 500, state: "running", lanes: 2, now: 9_000 });
    expect(view.board.map((l) => [l.lane, l.botId, l.state])).toEqual([[0, "ada", "waiting"], [1, "cy", "done"]]);
    expect(view.board[0]).toMatchObject({ teammates: 1, teammatesOpen: 1, files: [{ path: "notes/market.md", change: "added" }] });
    expect(view.board[1]).toMatchObject({ reply: "Here is the launch checklist.", startedAt: 1_020, finishedAt: 6_000 });
    expect(view.spans.filter((s) => s.assignmentId === "cb")).toEqual([expect.objectContaining({ botName: "Ben", depth: 1, parentId: "ra", state: "queued" }),
      expect.objectContaining({ state: "working", from: 2_100 })]);
    expect(view.marks.map((m) => [m.kind, m.botName])).toEqual([["handoff", "Ben"], ["done", "Cy"]]);
    expect(view.counts).toMatchObject({ waiting: 1, done: 1 });

    const again = missionView("m-launch", [lane(1, "cy", read("t-cy", [cyRoot])), adaLane],
      (id) => events[id] ?? [], (botId) => botId, 9_500);
    expect(again.version).toBe(view.version);
    events.cb!.push(...log("cb", ["parked", 7_000]));
    const moved = missionView("m-launch", [lane(0, "ada", read("t-ada", [adaRoot, { ...benHelp, status: "needs_input" }]))], (id) => events[id] ?? [], (b) => b, 9_600);
    expect(moved.version).not.toBe(view.version);
  });

  it("sums a mission from its lanes", () => {
    const summary = missionSummary("m", [
      lane(0, "ada", read("t-ada", [row("a", { status: "completed", finishedAt: 3_000 })])),
      lane(1, "ben", read("t-ben", [row("b", { status: "failed", outcome: "provider_error", finishedAt: 4_000 })])),
    ]);
    expect(summary).toMatchObject({ state: "partly-done", lanes: 2, finishedAt: 4_000, counts: { done: 1, failed: 1 } });
  });
});

describe("lane wording", () => {
  it("splits a reply that ends on a question for the person, and its suggested answer", () => {
    expect(splitAsk("Drafted two subject lines.\n\nNEEDS INPUT: Tuesday or Thursday?\nDefault: Tuesday")).toEqual({
      said: "Drafted two subject lines.", question: "Tuesday or Thursday?", suggested: "Tuesday" });
    expect(splitAsk("All done.")).toEqual({ said: "All done." });
  });

  it("says why a lane failed in its own words, never an outcome code", () => {
    const failed = missionView("m", [lane(0, "ada", read("t-ada", [row("r", { status: "failed", outcome: "provider_error", result: "Error: The price sheet answered 403" })]))],
      () => [], (b) => b, 9_000);
    expect(failed.board[0]).toMatchObject({ state: "failed", reason: "The price sheet answered 403" });
    expect(failed.board[0]!.reply).toBeUndefined();
    const silent = missionView("m", [lane(0, "ada", read("t-ada", [row("r", { status: "failed", outcome: "provider_error" })]))], () => [], (b) => b, 9_000);
    expect(silent.board[0]!.reason).toBe("Its engine reported an error");
    const asking = missionView("m", [lane(0, "ada", read("t-ada", [row("r", { status: "completed", result: "Two drafts.\nNEEDS INPUT: Which one?" })], { activity: "waiting-on-you" }))],
      () => [], (b) => b, 9_000);
    expect(asking.board[0]).toMatchObject({ state: "needs-input", question: "Which one?", reply: "Two drafts." });
  });
});

describe("laneFiles", () => {
  it("keeps the last thing each path went through", () => {
    expect(laneFiles([
      { added: ["a.md", "b.md"], changed: ["c.md"], deleted: [] },
      undefined,
      { added: [], changed: ["a.md", "d.md"], deleted: ["b.md", "e.md"] },
    ])).toEqual([
      { path: "a.md", change: "added" }, { path: "c.md", change: "changed" }, { path: "d.md", change: "changed" }, { path: "e.md", change: "deleted" },
    ]);
  });
});

describe("missionStateOf", () => {
  it("puts the person first, then work still open", () => {
    expect(missionStateOf(["done", "needs-input", "working"])).toBe("needs-input");
    expect(missionStateOf(["done", "working"])).toBe("running");
    expect(missionStateOf(["done", "done"])).toBe("done");
    expect(missionStateOf(["stopped", "idle"])).toBe("stopped");
    expect(missionStateOf(["failed", "stopped"])).toBe("failed");
    expect(missionStateOf([])).toBe("idle");
  });
});

describe("parseMissionTag", () => {
  it("checks every field of a person's mission", () => {
    expect(parseMissionTag({ id: "m-123456", title: "  Launch  ", lane: 2 }, 10_000)).toEqual({ ok: true, tag: { id: "m-123456", title: "Launch", lane: 2, launchedAt: 10_000 } });
    expect(parseMissionTag({ id: "m-123456", title: "x", lane: 0, launchedAt: 9_000 }, 10_000)).toMatchObject({ ok: true, tag: { launchedAt: 9_000 } });
    expect(parseMissionTag({ id: "../x", title: "x", lane: 0 }, 10_000).ok).toBe(false);
    expect(parseMissionTag({ id: "m-123456", title: " ", lane: 0 }, 10_000).ok).toBe(false);
    expect(parseMissionTag({ id: "m-123456", title: "x", lane: 8 }, 10_000).ok).toBe(false);
    expect(parseMissionTag({ id: "m-123456", title: "x", lane: 0, launchedAt: 999_999 }, 10_000).ok).toBe(false);
    expect(parseMissionTag("m-123456", 10_000).ok).toBe(false);
  });
});
