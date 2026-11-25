// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  signals: { enabled: true, notes: null as boolean | null, askUsage: false, askNotes: true } as Record<string, unknown> | null,
  calls: [] as Array<{ method: string; body?: unknown }>,
  failPut: false,
  signedIn: true,
  state: { connected: true, config: {}, bots: [] as Array<{ busy?: boolean }>, groups: [] as unknown[] },
}));
vi.mock("@/state/api", () => ({
  api: vi.fn(async (_path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    f.calls.push({ method, ...(body ? { body } : {}) });
    if (method === "GET") {
      if (!f.signals) throw new Error("offline");
      return f.signals;
    }
    if (f.failPut && body?.notes === true) throw new Error("offline");
    return { ...f.signals, ...body };
  }),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state }) }));
vi.mock("./funnel-account", () => ({ funnelAccount: () => ({ state: async () => ({ signedIn: f.signedIn, required: false, browser: false }) }) }));
vi.mock("../Avatar", () => ({ MausAvatar: () => null }));

const { NotesAskHost } = await import("./NotesAskHost");
const { resetNotesAsk } = await import("./notes-ask");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const host = document.createElement("div");
document.body.append(host);
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
async function render() {
  root ??= createRoot(host);
  await act(async () => { root!.render(createElement(NotesAskHost)); });
  await settle();
}
const card = () => document.querySelector("[data-notes-ask]");
const puts = () => f.calls.filter((call) => call.method === "PUT").map((call) => call.body);
const gets = () => f.calls.filter((call) => call.method === "GET").length;
const click = async (selector: string) => {
  await act(async () => { document.querySelector<HTMLButtonElement>(selector)!.click(); });
  await settle();
};

beforeEach(() => {
  resetNotesAsk();
  f.signals = { enabled: true, notes: null, askUsage: false, askNotes: true };
  f.calls = [];
  f.failPut = false;
  f.signedIn = true;
  f.state = { connected: true, config: {}, bots: [], groups: [] };
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("the session notes card", () => {
  it("shows on app open when the server asks, recording no at once; Share session notes turns notes on", async () => {
    await render();
    expect(card()).not.toBeNull();
    expect(card()!.textContent).toContain("Help improve dusk bot?");
    expect(puts()).toEqual([{ notes: false }]);
    await click("[data-notes-yes]");
    expect(puts()).toEqual([{ notes: false }, { notes: true }]);
    expect(card()).toBeNull();
  });

  it("Not now leaves notes off and hides it for good", async () => {
    await render();
    await click("[data-notes-no]");
    expect(card()).toBeNull();
    expect(puts()).toEqual([{ notes: false }]);
  });

  it("the example shows only how it went", async () => {
    await render();
    const toggle = document.querySelector<HTMLButtonElement>("[data-notes-example]")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click("[data-notes-example]");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(card()!.textContent).toContain("How it went");
    expect(card()!.textContent).not.toMatch(/What got in the way|How it ended|Taken out/);
  });

  it("a failed share says so and keeps the card for another try", async () => {
    f.failPut = true;
    await render();
    await click("[data-notes-yes]");
    expect(card()!.querySelector("[role=alert]")!.textContent).toContain("Couldn't save your answer");
  });

  it("never shows when the server does not ask, the read fails or nobody is signed in", async () => {
    f.signals = { enabled: true, notes: false, askUsage: false, askNotes: false };
    await render();
    expect(card()).toBeNull();
    await act(async () => root?.unmount()); root = null;
    f.signals = null;
    await render();
    expect(card()).toBeNull();
    await act(async () => root?.unmount()); root = null;
    f.signals = { enabled: true, notes: null, askUsage: false, askNotes: true };
    f.signedIn = false;
    await render();
    expect(card()).toBeNull();
    expect(puts()).toEqual([]);
  });

  it("waits while a bot works, then asks once its reply finishes", async () => {
    f.state = { ...f.state, bots: [{ busy: true }] };
    await render();
    expect(card()).toBeNull();
    expect(gets()).toBe(0);
    f.state = { ...f.state, bots: [{ busy: false }] };
    await render();
    expect(card()).not.toBeNull();
  });

  it("checks again after a reply finishes, never mid-turn", async () => {
    f.signals = { enabled: true, notes: false, askUsage: false, askNotes: false };
    await render();
    expect(gets()).toBe(1);
    f.signals = { enabled: true, notes: false, askUsage: false, askNotes: true };
    f.state = { ...f.state, bots: [{ busy: true }] };
    await render();
    expect(card()).toBeNull();
    f.state = { ...f.state, bots: [{ busy: false }] };
    await render();
    expect(gets()).toBe(2);
    expect(card()).not.toBeNull();
  });
});
