// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { InstanceInfo } from "@/state/store";

const fx = vi.hoisted(() => ({ refreshInstances: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  const instances = [{ instanceId: "deepseek", driverKind: "deepseekAgent", displayName: "DeepSeek Harness", snapshot: { state: "unavailable" },
    install: { platform: "linux", command: { linux: "npm install -g @deepseek-ai/dsh" }, server: { package: "@deepseek-ai/dsh" } }, models: { default: "m", options: [] } }] as unknown as InstanceInfo[];
  return {
    ...actual,
    useStore: () => ({ state: { ...actual.initialState, config: { deepseek: { configured: true, last4: "9z9z" } }, instances }, dispatch: vi.fn(), refreshInstances: fx.refreshInstances }),
  };
})(importOriginal)));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { KeyRow } = await import("./KeyRow");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  fx.refreshInstances.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(KeyRow, { id: "deepseek" })));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const install = () => host.querySelector<HTMLButtonElement>("[data-key-engine-check]")!;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("installs the key's own engine in place, says plainly when that failed, and clears it on Try again", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "npm could not install @deepseek-ai/dsh" }), { status: 500 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ instances: [] })));
  vi.stubGlobal("fetch", fetchMock);
  const missing = host.querySelector("[data-key-engine-missing]")!;
  expect(missing.textContent).not.toContain("npm install");
  expect(install().textContent).toBe("Install DeepSeek Harness here");
  flushSync(() => install().click());
  await settle();
  expect(String(fetchMock.mock.calls[0]![0])).toContain("/api/instances/deepseek/install");
  expect(host.querySelector("[data-key-engine-missing] [role=alert]")?.textContent).toBe("DeepSeek Harness couldn't be installed on the computer your bots run on. Try again in a moment.");
  expect(install().textContent).toBe("Try again");

  flushSync(() => install().click());
  await settle();
  expect(fx.refreshInstances).toHaveBeenCalledWith({ reportErrors: true });
  expect(host.querySelector("[data-key-engine-missing] [role=alert]")).toBeNull();
  vi.unstubAllGlobals();
});
