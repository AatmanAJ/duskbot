// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [] as Bot[] },
    dispatch: fixture.dispatch,
  }) };
})(importOriginal)));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "x", message: "" } }, ready: true }),
  useCaptionChrome: () => ({}),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { Transcript } = await import("./GroupView");
const { RoomHoldsBanner } = await import("./RoomHoldsBanner");

const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch", memberIds: ["lead", "bee"],
  defaultResponder: { kind: "member", botId: "lead" }, bulletin: "", unread: false,
  createdAt: 1, messages: [],
};
const lead = { id: "lead", name: "Lead", color: "blue" } as Bot;
const bee = { id: "bee", name: "Bee", color: "green" } as Bot;
const from = { botId: "lead", name: "Lead", color: "blue" as const };
const ask: Message = { id: "ask", role: "user", kind: "text", at: 1_000, text: "Fix the title" };
const note = (id: string, text: string, at: number): Message => ({ id, role: "bot", kind: "text", at, text, from, turnId: "turn-1" });

let host: HTMLDivElement;
let root: Root;
const render = (element: ReturnType<typeof createElement>) => flushSync(() => root.render(element));
const transcript = (messages: Message[]) => createElement(Transcript, {
  group: room, members: [lead, bee], locale: "en", messages, transcript: messages, onReply: () => {},
});

beforeEach(() => {
  fixture.dispatch.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("a member's room reply", () => {
  it("keeps a finished turn's working notes as bubbles above the reply, with no fold, as a 1:1 chat does", () => {
    const messages = [
      ask,
      note("n1", "I'll check my own work history…", 2_000),
      { ...note("final", "Fixed: the title now reads Launch.", 9_000), turnTerminal: true },
    ];
    render(transcript(messages));
    expect(host.textContent).not.toContain("Worked for");
    expect(host.textContent!.indexOf("I'll check my own work history")).toBeLessThan(host.textContent!.indexOf("Fixed: the title"));
    expect(host.textContent!.match(/Lead/g)).toHaveLength(1);
  });

  it("keeps every line of a turn that is still running", () => {
    render(transcript([ask, note("n1", "I'll check my own work history…", 2_000), note("n2", "Good, correct layer id…", 3_000)]));
    expect(host.textContent).toContain("I'll check my own work history");
    expect(host.textContent).toContain("Good, correct layer id");
    expect(host.textContent).not.toContain("Worked for");
  });
});

describe("held room members", () => {
  it("lists who is held and resumes one from the banner", () => {
    render(createElement(RoomHoldsBanner, { group: { ...room, holds: { bee: { at: 1 } } }, members: [lead, bee] }));
    expect(host.textContent).toContain("Stopped by you: Bee.");
    const resume = [...host.querySelectorAll("button")].find((button) => button.textContent === "Resume Bee")!;
    flushSync(() => resume.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "setGroupHold", groupId: "room", botId: "bee", held: false });
  });

  it("shows nothing when nobody is held", () => {
    render(createElement(RoomHoldsBanner, { group: { ...room, holds: {} }, members: [lead, bee] }));
    expect(host.innerHTML).toBe("");
  });
});
