// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { ConfigStatus, InstanceInfo } from "@/state/store";
import type { KeyCheck } from "@/components/keys/key-save";

const f = vi.hoisted(() => ({
  instances: [] as InstanceInfo[],
  config: {} as Partial<ConfigStatus>,
  checks: [] as Array<(check: KeyCheck) => void>,
}));
vi.mock("@/state/store", async (original) => {
  const store = await original<typeof import("@/state/store")>();
  return {
    ...store,
    useStore: () => ({ state: { ...store.initialState, config: f.config, instances: f.instances }, dispatch: vi.fn(), refreshInstances: vi.fn(async () => {}) }),
  };
});
vi.mock("@/components/keys/key-save", async (original) => ({
  ...await original<typeof import("@/components/keys/key-save")>(),
  saveKey: vi.fn(async () => ({ xai: { configured: true, last4: "lkey" } })),
  checkKey: vi.fn(() => new Promise<KeyCheck>((resolve) => f.checks.push(resolve))),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
const { AiCards } = await import("./AiCards");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const xai = (authenticated: boolean | undefined): InstanceInfo => ({
  instanceId: "xaiApi", driverKind: "grok", displayName: "xAI", access: "api",
  snapshot: authenticated === undefined ? { state: "unavailable", reason: "No xAI API key" } : { state: "available", authenticated },
  models: { default: "grok-4", options: [] },
} as InstanceInfo);
let host: HTMLDivElement, root: Root;
const show = () => act(async () => { root.render(createElement(AiCards, { tested: null })); });
const tile = () => host.querySelector<HTMLElement>("[data-funnel-ai=grok]")!;
const card = () => host.querySelector("[data-funnel-ai-connect=grok]");
const type = (text: string) => {
  const input = card()!.querySelector<HTMLInputElement>("input[data-key-input]")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (name: string) => [...card()!.querySelectorAll("button")].find((one) => one.textContent?.trim() === name)!;

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("confirm", () => true);
  f.instances = [xai(undefined)];
  f.config = {};
  f.checks = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("calls a pasted key connected only once its check passes, keeps a failed one open to replace, and lets a connected key be changed", async () => {
  await show();
  await act(async () => { tile().click(); });
  await act(async () => { type("xai-notarealkey"); });
  await act(async () => { button("Save").click(); });
  // saved: the server now counts the engine signed in on the key's presence, but nobody has checked the key yet
  f.config = { xai: { configured: true, last4: "lkey" } };
  f.instances = [xai(true)];
  await show();
  expect(tile().hasAttribute("data-connected")).toBe(false);
  expect(card()?.textContent).toContain("Checking");

  await act(async () => { f.checks.shift()!({ result: "rejected", ok: false, text: "Didn't work: The provider rejected this key." }); });
  f.instances = [xai(false)];
  await show();
  expect(tile().hasAttribute("data-connected")).toBe(false);
  expect(card()?.textContent).toContain("The provider rejected this key.");
  await act(async () => { button("Replace").click(); });
  await act(async () => { type("xai-fixturegoodkey"); });
  await act(async () => { button("Save").click(); });
  f.instances = [xai(true)];
  await show();
  expect(tile().hasAttribute("data-connected")).toBe(false);

  await act(async () => { f.checks.shift()!({ result: "ok", ok: true, text: "Saved. It works." }); });
  await show();
  expect(tile().hasAttribute("data-connected")).toBe(true);
  expect(tile().tagName).toBe("BUTTON");
  expect(tile().getAttribute("aria-label")).toBe("Grok is connected with your API key. Change the key");
  expect(card()?.querySelector("[data-key-replace]")).not.toBeNull();
});
