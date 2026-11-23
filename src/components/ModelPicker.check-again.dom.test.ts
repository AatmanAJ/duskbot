// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({
  advanced: false,
  instances: [] as InstanceInfo[],
  bots: [] as Bot[],
  dispatch: vi.fn(),
  refreshModels: vi.fn(() => Promise.resolve()),
  refreshInstances: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: fixture.bots, modelVariantSessions: {}, config: {} },
    dispatch: fixture.dispatch,
    refreshInstances: fixture.refreshInstances,
    refreshModels: fixture.refreshModels,
  }),
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
// the connect itself (connect-flow) has its own tests; here only that the picker starts it and shows its stages in place
const connect = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn() }));
vi.mock("@/components/onboarding/SignInPill", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/onboarding/SignInPill")>()),
  useConnectFlow: () => ({ state: { stage: "preparing", since: Date.now() }, target: null, start: connect.start, cancel: connect.cancel,
    retry: () => {}, openAgain: () => {}, submit: () => {} }),
}));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null }));

const { ModelPicker } = await import("@/components/ModelPicker");

type Option = InstanceInfo["models"]["options"][number];
const claude = (options: Option[], authenticated = true): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription",
  snapshot: { state: "available", version: "2.1.300", authenticated },
  models: { default: options[0]!.id, options },
  capabilities: { effortLevels: ["low", "medium", "high"] },
});
const three: Option[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
];
const scout = (model = "claude-opus-5-5"): Bot => ({
  id: "scout", threadId: "thread-scout", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "claude", model },
});
let host: HTMLDivElement;
let root: Root;
const parentKey = vi.fn();
const render = (bot = scout()) => flushSync(() => root.render(createElement("div", { onKeyDown: (event: { key: string }) => parentKey(event.key) },
  createElement(ModelPicker, { bot, threadId: bot.threadId }))));
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const chip = () => host.querySelector<HTMLButtonElement>('[data-tour="model"]')!;
const menu = () => document.querySelector<HTMLElement>("[data-model-picker-content]");
const focused = () => document.activeElement as HTMLElement | null;
const press = (key: string, target: Element | null = focused(), init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  flushSync(() => target!.dispatchEvent(event));
  return event;
};
const openWith = async (key: "ArrowDown" | "click") => {
  chip().focus();
  if (key === "click") flushSync(() => chip().click());
  else press(key, chip());
  await settle();
};

beforeEach(() => {
  fixture.advanced = false;
  fixture.bots = [];
  fixture.instances = [claude(three)];
  fixture.dispatch.mockReset();
  connect.start.mockReset();
  connect.cancel.mockReset();
  parentKey.mockReset();
  document.documentElement.dataset.reducedMotion = "true";
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  render();
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

it("Check again on an engine with no models says when the check failed, instead of the same empty note", async () => {
  const empty: InstanceInfo = { ...claude(three), models: { default: "", options: [] } };
  fixture.instances = [empty];
  fixture.refreshInstances.mockImplementation(() => Promise.reject(new Error("The Claude app didn't answer.")));
  render();
  await openWith("click");
  const again = document.querySelector<HTMLButtonElement>("[data-simple-refresh]");
  expect(again).not.toBeNull();
  flushSync(() => again!.click());
  await settle();
  await settle();
  expect(fixture.refreshInstances).toHaveBeenCalled();
  expect(menu()!.querySelector("[role=alert]")?.textContent).toBeTruthy();
});

it("the failed-check note goes once the engines are read again", async () => {
  const empty: InstanceInfo = { ...claude(three), models: { default: "", options: [] } };
  fixture.instances = [empty];
  fixture.refreshInstances.mockImplementation(() => Promise.reject(new Error("The Claude app didn't answer.")));
  render();
  await openWith("click");
  flushSync(() => document.querySelector<HTMLButtonElement>("[data-simple-refresh]")!.click());
  await settle();
  await settle();
  expect(menu()!.querySelector("[role=alert]")).not.toBeNull();
  fixture.instances = [{ ...empty }];
  render();
  await settle();
  expect(menu()!.querySelector("[role=alert]")).toBeNull();
  expect(menu()!.textContent).toContain("No models to show here yet.");
});
