// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { retryLoad, StoreProvider, useStore, type AppState, type BotAnnouncement } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FixtureEventSource {
  static opened: FixtureEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  constructor(readonly url: string) { FixtureEventSource.opened.push(this); }
  close() {}
  send(frame: object, id = "fixture:1") { this.onmessage?.({ data: JSON.stringify(frame), lastEventId: id }); }
}

const bot: BotAnnouncement = {
  id: "fixture", threadId: "fixture-thread", name: "Fixture", title: "", description: "",
  notifications: true, unread: false, color: "green", modelSelection: { instanceId: "fake", model: "fake" },
  messages: [], tasks: [{ threadId: "fixture-thread", title: "Fixture", createdAt: 1 }],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  FixtureEventSource.opened = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("says the first chat load failed instead of loading for ever, and loads when asked again", async () => {
  let failing = true;
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path.startsWith("/api/bots?")) return failing ? json({ error: "internal" }, 500) : json({ bots: [bot], groups: [] });
    if (path === "/api/instances") return json({ instances: [] });
    return json({});
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let state!: AppState;
  function Probe() { state = useStore().state; return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(StoreProvider, null, createElement(Probe))));
  await act(async () => { FixtureEventSource.opened[0]!.send({ kind: "hello", resumed: false, cursor: "fixture:0" }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(state.hydrated).toBeUndefined();
  expect(state.loadFailed).toBe(true);

  failing = false;
  await act(async () => { retryLoad(); await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(state.hydrated).toBe(true);
  expect(state.loadFailed).toBeUndefined();
  expect(state.bots.map((one) => one.name)).toEqual(["Fixture"]);
});

it("keeps asking every moment while the person's cloud wakes, without saying the load failed", async () => {
  let waking = true;
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path.startsWith("/api/bots?")) return waking ? json({ error: "waking" }, 503) : json({ bots: [bot], groups: [] });
    if (path === "/api/instances") return json({ instances: [] });
    return json({});
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let state!: AppState;
  function Probe() { state = useStore().state; return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(StoreProvider, null, createElement(Probe))));
  await act(async () => { FixtureEventSource.opened[0]!.send({ kind: "hello", resumed: false, cursor: "fixture:0" }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect(state.loadWaking).toBe(true);
  expect(state.loadFailed).toBeUndefined();

  waking = false;
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_600)); });
  expect(state.hydrated).toBe(true);
  expect(state.loadWaking).toBeUndefined();
  expect(state.bots.map((one) => one.name)).toEqual(["Fixture"]);
});
