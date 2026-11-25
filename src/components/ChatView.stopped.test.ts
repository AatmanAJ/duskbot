// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("@/state/store");
const { forgetStops, sendStop } = await import("@/lib/stop-turn");
const { noteReplyEvent, resetLiveReplies } = await import("@/state/live-reply");
const { t } = await import("@/lib/i18n");
const { LINE_SPECS, WORKING_LINE } = await import("@/lib/working-line");
const { PERSON_STOPPED_TURN_NAME, STOPPED_TURN_NAME } = await import("../../shared/client-cancel");

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  forgetStops();
  resetLiveReplies();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  root.unmount();
  container.remove();
  vi.unstubAllGlobals();
});

const instances = [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo];
const scout = (messages: Message[], busy: boolean): Bot => ({
  id: "scout", threadId: "t", name: "Scout", title: "", description: "", color: "green", notifications: true, unread: false,
  busy, messages, modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "t", title: "Poem", createdAt: 1, busy, activity: busy ? "working" : "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
});
const draw = (bot: Bot) => {
  const state: AppState = { ...initialState, connected: true, selectedId: bot.id, bots: [bot], instances };
  const value = { state, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(ChatView, { bot }) })));
};
const ask: Message = { id: "u1", role: "user", kind: "text", text: "Write a 250 word poem about cheese", at: Date.now() - 2_000 };

const stopped = () => container.querySelector("[data-turn-stopped]");
const said = () => [...container.querySelectorAll("[data-message-row]")].map((row) => row.textContent ?? "");
// the word comes once the working line has left (140ms)
const settle = () => new Promise((done) => setTimeout(done, LINE_SPECS[WORKING_LINE].exitMs + 80));
const press = () => sendStop(async () => ({ ok: true }), { type: "interrupt", botId: "scout", threadId: "t" }, () => {});

it("says Stopped once, quietly, as soon as the working line has left, before the server has answered", async () => {
  draw(scout([ask], true));
  expect(stopped()).toBeNull();
  press();
  draw(scout([ask], true));
  await settle();
  expect(stopped()?.textContent).toBe(t("chat.turnStopped"));
  expect(stopped()?.getAttribute("role")).toBe("status");
  // still there once the server says the bot is idle, and no second row says it again
  draw(scout([ask, { id: "s1", role: "bot", kind: "activity", tool: { name: PERSON_STOPPED_TURN_NAME, ok: true }, at: Date.now() }], false));
  expect(container.querySelectorAll("[data-turn-stopped]")).toHaveLength(1);
  expect(container.textContent?.split(t("chat.turnStopped")).length).toBe(2);
});

it("keeps what the bot said before the press, and never lets in a bubble of that turn that lands after it", async () => {
  const first: Message = { id: "b1", role: "bot", kind: "text", text: "Cheese begins as milk", turnId: "turn-1", at: Date.now() - 1_000 };
  draw(scout([ask, first], true));
  press();
  draw(scout([ask, first], true));
  const late: Message = { id: "b2", role: "bot", kind: "text", text: "Then rennet sets it", turnId: "turn-1", at: Date.now() };
  draw(scout([ask, first, late], true));
  draw(scout([ask, first, late], false));
  await settle();
  expect(said().some((text) => text.includes("Cheese begins as milk"))).toBe(true);
  expect(said().some((text) => text.includes("Then rennet sets it"))).toBe(false);
  expect(stopped()).not.toBeNull();
});

it("settles the words streamed by the press as a bubble at once, and the server's copy takes its place", async () => {
  draw(scout([ask], true));
  noteReplyEvent({ eventId: "e", provider: "fake", threadId: "t", turnId: "turn-1", createdAt: "", type: "content.delta", streamKind: "assistant_text", delta: "Then rennet sets it, the curd" } as never);
  press();
  draw(scout([ask], true));
  expect(said().filter((text) => text.includes("Then rennet sets it, the curd"))).toHaveLength(1);
  draw(scout([ask, { id: "b2", role: "bot", kind: "text", text: "Then rennet sets it, the curd", at: Date.now() }], false));
  await settle();
  expect(said().filter((text) => text.includes("Then rennet sets it, the curd"))).toHaveLength(1);
  expect(container.querySelector('[data-message-row][data-arrival]')).toBeNull();
});

it("remembers a Stop from another window by the server's row, and says nothing once the person writes again", () => {
  const stopRow: Message = { id: "s1", role: "bot", kind: "activity", tool: { name: PERSON_STOPPED_TURN_NAME, ok: true }, at: Date.now() };
  draw(scout([ask, { id: "b1", role: "bot", kind: "text", text: "Cheese, oh cheese", at: Date.now() }, stopRow], false));
  expect(stopped()).not.toBeNull();
  draw(scout([ask, stopRow, { id: "u2", role: "user", kind: "text", text: "Go on", at: Date.now() }], false));
  expect(stopped()).toBeNull();
});

it("says nothing for a turn nobody stopped", () => {
  draw(scout([ask], false));
  expect(container.textContent).not.toContain(t("chat.turnStopped"));
  draw(scout([ask, { id: "s1", role: "bot", kind: "activity", tool: { name: STOPPED_TURN_NAME, ok: true }, at: Date.now() }], false));
  expect(container.textContent).not.toContain(t("chat.turnStopped"));
});
