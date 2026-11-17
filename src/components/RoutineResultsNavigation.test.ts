import { Children, createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, Group } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { state: undefined as AppState | undefined, dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state ?? original.initialState, dispatch: fixture.dispatch }) };
})(importOriginal)));
// The real useCaptionChrome rides along: it only asks this module for the window chrome.
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { initialState } = await import("@/state/store");
const { ChatView } = await import("./ChatView");

const bot: Bot = {
  id: "runner", threadId: "execution", name: "Runner", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" },
  tasks: [
    { threadId: "execution", title: "run details", createdAt: 1, routineRunId: "run", busy: false },
    { threadId: "new-results", title: "New destination", createdAt: 2 },
    { threadId: "original-source", title: "Original conversation", createdAt: 0 },
  ],
};
const group: Group = {
  id: "room", threadId: "current-room-thread", name: "Team", memberIds: [bot.id],
  createdAt: 0, messages: [], unread: false, defaultResponder: { kind: "mentions" }, bulletin: "",
  tasks: [
    { threadId: "current-room-thread", title: "Current", createdAt: 2 },
    { threadId: "original-room-source", title: "Original request", createdAt: 0 },
  ],
};
const routine: Routine = {
  id: "routine", name: "Daily report", prompt: "Report progress", target: "bot", botId: bot.id,
  runOn: "maus", enabled: true, schedule: { type: "daily", time: "09:00", weekdays: [1] },
  durationMinutes: 30, nextRunAt: 1_000, createdAt: 0, updatedAt: 2,
  resultsThreadId: "new-results", sourceThreadId: "original-source",
};
const run: RoutineRun = {
  id: "run", routineId: routine.id, routineName: routine.name, target: "bot", botId: bot.id,
  runOn: "maus", threadId: "execution", sourceThreadId: "original-source", scheduledFor: 100,
  createdAt: 100, finishedAt: 200, status: "completed", manual: false,
};

type Button = { children?: ReactNode; onClick?: () => void };
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  return Children.toArray(node).map((child) => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : textOf(child)).join("");
}

/** Captures the real component's returned controls under React's hook dispatcher. */
function buttonsFrom(render: () => ReactNode): Map<string, Button> {
  const buttons = new Map<string, Button>();
  function visit(node: ReactNode) {
    Children.forEach(node, (child) => {
      if (!isValidElement<Button>(child)) return;
      if (child.type === "button") buttons.set(textOf(child.props.children), child.props);
      visit(child.props.children);
    });
  }
  function Capture() { visit(render()); return null; }
  renderToStaticMarkup(createElement(Capture));
  return buttons;
}

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.state = { ...initialState, bots: [bot], groups: [group], routines: [routine], routineRuns: [run] };
});
afterAll(() => vi.unstubAllGlobals());

describe("routine results navigation", () => {
  it("returns from an execution chat to its group-owned source task", () => {
    fixture.state!.routineRuns = [{ ...run, sourceThreadId: "original-room-source" }];
    const buttons = buttonsFrom(() => ChatView({ bot }));
    expect(buttons.has("Back to results")).toBe(true);
    buttons.get("Back to results")!.onClick!();
    expect(fixture.dispatch.mock.calls).toEqual([
      [{ type: "select", id: group.id }],
      [{ type: "switchGroupTask", groupId: group.id, threadId: "original-room-source" }],
      [{ type: "revealThread", threadId: "original-room-source" }],
    ]);
  });

  it("omits Back to results when the execution's recorded destination was deleted", () => {
    fixture.state!.routineRuns = [{ ...run, resultsThreadId: "deleted-destination" }];
    expect(buttonsFrom(() => ChatView({ bot })).has("Back to results")).toBe(false);
  });

  it("shows no run banner when the run worked inside the conversation its results go to", () => {
    fixture.state!.routineRuns = [{ ...run, resultsThreadId: "execution", sourceThreadId: "execution" }];
    const buttons = buttonsFrom(() => ChatView({ bot }));
    expect(buttons.has("Back to results")).toBe(false);
    expect(buttons.has("open routine")).toBe(false);
  });
});
