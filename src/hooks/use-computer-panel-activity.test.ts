// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { publishLiveFrame } from "@/lib/live-events";
import { useComputerPanelActivity } from "./use-computer-panel-activity";

const remote = vi.hoisted(() => ({ status: {} as Record<string, unknown> }));
vi.mock("@/state/store", async () => (await import("@/testing/store-mock")).withStoreHooks(await (() => ({ api: vi.fn(async () => remote.status) }))()));
const dispatch = vi.fn();
const bot = { id: "one", threadId: "thread", computer: "cloud", tasks: [] } as unknown as Bot;
const host = document.createElement("div");
let root = createRoot(host);
function Probe(props: { selected?: Bot; settings?: boolean; target?: string }) {
  useComputerPanelActivity({ bot: props.selected ?? bot, active: true, settingsOpen: props.settings ?? false, targetKey: props.target, dispatch });
  return null;
}
function draw(props: Parameters<typeof Probe>[0] = {}) { flushSync(() => root.render(createElement(Probe, props))); }
function state(botId: string, state: "starting" | "ready" | "stopped", resourceKey = `computer:vps:main:${botId}`) {
  flushSync(() => publishLiveFrame({ kind: "computer-state", botId, resourceKey, state }));
}
beforeEach(() => { remote.status = {}; vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), clear: vi.fn() }); });
afterEach(() => { flushSync(() => root.unmount()); root = createRoot(host); dispatch.mockClear(); localStorage.clear(); });

it("opens the selected bot's active desktop once per wake cycle without reopening after a manual close", () => {
  draw();
  expect(dispatch).not.toHaveBeenCalled();
  state("one", "starting");
  expect(dispatch).toHaveBeenCalledWith({ type: "toggleComputer", open: true });
  draw({ settings: true });
  draw();
  state("one", "ready");
  expect(dispatch).toHaveBeenCalledTimes(1);
  state("one", "stopped");
  expect(dispatch).toHaveBeenCalledTimes(1);
  state("one", "starting");
  expect(dispatch).toHaveBeenCalledTimes(2);
});

it("remembers other bot activity and opens only when that bot is selected", () => {
  draw();
  state("two", "ready");
  expect(dispatch).not.toHaveBeenCalled();
  draw({ selected: { ...bot, id: "two" } });
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("keeps settings and local desktop choices undisturbed", () => {
  draw({ settings: true });
  state("one", "starting");
  expect(dispatch).not.toHaveBeenCalled();
  draw({ selected: { ...bot, computer: "local" } });
  state("one", "ready");
  expect(dispatch).not.toHaveBeenCalled();
  draw();
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("treats the legacy activity followed by a resource event as one wake cycle", () => {
  draw();
  flushSync(() => publishLiveFrame({ kind: "computer", botId: "one", state: "waking" }));
  state("one", "ready");
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("opens an already-awake selected computer on reload without an event", async () => {
  remote.status = { surface: "cloud", ready: true, resourceKey: "resource" };
  draw();
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledWith({ type: "toggleComputer", open: true }));
});

it("rechecks an already-awake selection when its configured target changes", async () => {
  draw({ target: "old" });
  remote.status = { surface: "cloud", ready: true, resourceKey: "new-resource" };
  draw({ target: "new" });
  await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
});
