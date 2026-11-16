import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InstanceInfo } from "@/state/store";

// Hook-by-call-order harness: useState is held by call order (the picker's own hooks first, children after), effects
// never run, and handlers are read off the element tree.
const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return {
    values: [] as unknown[],
    index: 0,
    own: 0,
    instances: [] as InstanceInfo[],
    dispatch: (() => {}) as (...args: unknown[]) => void,
    refreshInstances: (() => Promise.resolve()) as () => Promise<void>,
    refreshModels: ((_id: string) => Promise.resolve()) as (instanceId: string) => Promise<void>,
  };
});
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: () => {},
}));
// This hook fixture does not emulate React's render-time state retries.
vi.mock("./MenuMotion", () => ({ useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "" }) }));
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: [], modelVariantSessions: {} },
    dispatch: fixture.dispatch,
    refreshInstances: fixture.refreshInstances,
    refreshModels: fixture.refreshModels,
  }),
}))(importOriginal)));

// These cases cover the full picker; Simple mode has its own file.

const { LOCAL_PROBE_TIMEOUT_MS, offersLocalModels, probeLocalModels } = await import("./local-model-probe");

afterAll(() => vi.unstubAllGlobals());


const official = [{ id: "claude-opus-5-5", label: "Opus 5.5" }, { id: "claude-sonnet-5", label: "Sonnet 5" }];
const claudeInstall = {
  command: { darwin: "npm install -g @anthropic-ai/claude-code", linux: "npm install -g @anthropic-ai/claude-code", win32: "npm install -g @anthropic-ai/claude-code" },
  signInCommand: "claude",
};
const claude = (snapshot: InstanceInfo["snapshot"], options: InstanceInfo["models"]["options"] = official): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", snapshot,
  models: { default: "claude-opus-5-5", options }, install: claudeInstall,
  authentication: { method: "paste-code", signOut: true },
});
const signedOut = () => claude({ state: "available", version: "2.1.300", authenticated: false });
const signedIn = () => claude({ state: "available", version: "2.1.300", authenticated: true });
const notFound = () => claude({ state: "unavailable", reason: "`claude` CLI not found" });
const codex: InstanceInfo = {
  instanceId: "codex", driverKind: "codex", displayName: "Codex", access: "subscription",
  snapshot: { state: "available", version: "1.0.0", authenticated: true },
  models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
};







beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.own = 0;
  fixture.dispatch = vi.fn();
  fixture.refreshInstances = vi.fn(() => Promise.resolve());
  fixture.refreshModels = vi.fn(() => Promise.resolve());
});
afterEach(() => vi.useRealTimers());



describe("the way into local models", () => {
  it("is offered by Claude whenever its CLI is present, and by other engines once they list a local model", () => {
    expect(offersLocalModels(signedIn(), 0)).toBe(true);
    expect(offersLocalModels(signedOut(), 0)).toBe(true);
    expect(offersLocalModels(notFound(), 0)).toBe(false);
    expect(offersLocalModels({ ...signedIn(), policy: { organizationName: "Fixture", reason: "Not allowed" } }, 0)).toBe(false);
    expect(offersLocalModels(codex, 0)).toBe(false);
    expect(offersLocalModels(codex, 2)).toBe(true);
    expect(offersLocalModels(undefined, 0)).toBe(false);
  });

  it("stops looking after a short timeout and never throws", async () => {
    vi.useFakeTimers();
    let settled = false;
    void probeLocalModels("claude", () => new Promise(() => {})).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(LOCAL_PROBE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    await expect(probeLocalModels("claude", () => Promise.reject(new Error("offline")))).resolves.toBeUndefined();
  });
});
