import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { bots: [] as Bot[] };
});
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: vi.fn() }) };
})(importOriginal)));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { GroupView } = await import("./GroupView");
const { noteTurnEvent, resetTurnLive } = await import("@/state/turn-status");
afterAll(() => vi.unstubAllGlobals());
afterEach(() => resetTurnLive());

const ada = { id: "ada", name: "Ada", color: "blue", busy: true, messages: [], notifications: true, unread: false, title: "", description: "", modelSelection: { instanceId: "test", model: "default" } } as unknown as Bot;
fixture.bots = [ada];
const at = Date.UTC(2026, 9, 23, 12);
const ask: Message = { id: "u", role: "user", kind: "text", at, text: "Ada, build the dashboard" };
const said: Message = { id: "a", role: "bot", kind: "text", at: at + 5_000, text: "On it: writing the page now.", from: { botId: "ada", name: "Ada", color: "blue" } };
const room = (messages: Message[]): Group => ({
  id: "room", threadId: "room-thread", name: "Planning", memberIds: ["ada"], defaultResponder: { kind: "member", botId: "ada" },
  bulletin: "", unread: false, createdAt: 1, messages, busyBotId: "ada", turnStartedAt: at,
} as unknown as Group);
const draw = (messages: Message[]) => renderToStaticMarkup(createElement(GroupView, { group: room(messages) }));
const engine = (type: "turn.progress" | "turn.completed") => noteTurnEvent({
  eventId: type, provider: "claudeAgent", threadId: "room-thread", createdAt: new Date(at).toISOString(), turnId: "t1",
  ...(type === "turn.progress" ? { type, activity: "write", itemId: "w", file: "index.html", bytes: 3 * 1024 } : { type, ok: true }),
} as never);

describe("a room's speaker through a long turn", () => {
  it("keeps the mascot and its status line after the speaker's words until the turn ends", () => {
    expect(draw([ask, said]), "Ada spoke mid-turn: her mascot stays").toContain("turn-presence");
    engine("turn.progress");
    const writing = draw([ask, said]);
    expect(writing, "the 1:1 status line: a friendly phrase").toContain("Writing some code");
    const line = /data-turn-status="true">(.*?)<\/span><\/span><\/span>/.exec(writing)?.[1]?.replace(/<[^>]+>/g, "");
    expect(line, "one working bot keeps the plain 1:1 line: the phrase alone, no name, file, size, timer or lead word").toBe("Writing some code");
    expect(writing).not.toMatch(/data-turn-name="">Ada</);
    expect(writing).not.toContain("room-stop-member");
    engine("turn.completed");
    expect(draw([ask, said]), "the turn ended: her settled reply needs no mascot").not.toContain("turn-presence");
  });
});
