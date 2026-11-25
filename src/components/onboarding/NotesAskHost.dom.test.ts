// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  signals: { enabled: true, notes: null as boolean | null, askUsage: false, askNotes: true } as Record<string, unknown> | null,
  calls: [] as Array<{ method: string; body?: unknown }>,
  failPut: false,
  slowNo: null as null | (() => void),
  done: [] as unknown[],
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
    if (f.slowNo && body?.notes === false) await new Promise<void>((resolve) => { f.slowNo = resolve; });
    f.done.push(body);
    return { ...f.signals, ...body };
  }),
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state }) }));
vi.mock("./funnel-account", () => ({ funnelAccount: () => ({ state: async () => ({ signedIn: f.signedIn, required: false, browser: false }) }) }));
vi.mock("../Avatar", () => ({ MausAvatar: () => null }));

const { NotesAskHost, NOTES_ASK_BEAT_MS } = await import("./NotesAskHost");
const { resetNotesAsk } = await import("./notes-ask");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const host = document.createElement("div");
document.body.append(host);
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
async function render(wait = NOTES_ASK_BEAT_MS + 300) {
  root ??= createRoot(host);
  await act(async () => { root!.render(createElement(NotesAskHost)); });
  await settle();
  await pass(wait);
}
async function pass(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
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
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  resetNotesAsk();
  f.slowNo = null;
  f.done = [];
  f.signals = { enabled: true, notes: null, askUsage: false, askNotes: true };
  f.calls = [];
  f.failPut = false;
  f.signedIn = true;
  f.state = { connected: true, config: {}, bots: [], groups: [] };
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.querySelectorAll("[data-test-extra]").forEach((node) => node.remove());
});

describe("the session notes card", () => {
  it("shows on app open when the server asks, recording no at once; Share session notes turns notes on", async () => {
    await render();
    expect(card()).not.toBeNull();
    expect(card()!.textContent).toContain("Help improve dusk bot?");
    const yes = card()!.querySelector<HTMLElement>("[data-notes-yes]")!;
    expect(yes.classList.contains("bot-button")).toBe(true);
    expect(yes.style.getPropertyValue("--bot-button")).not.toBe("");
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

  it("waits a beat after a reply finishes, so the reply is read first", async () => {
    f.state = { ...f.state, bots: [{ busy: true }] };
    await render();
    f.state = { ...f.state, bots: [{ busy: false }] };
    await render(NOTES_ASK_BEAT_MS - 500);
    expect(card()).toBeNull();
    expect(gets()).toBe(0);
    await pass(800);
    expect(card()).not.toBeNull();
  });

  it("never opens over another sheet, a menu or a half-written message", async () => {
    const sheet = Object.assign(document.createElement("div"), { role: "dialog" });
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("data-test-extra", "");
    document.body.append(sheet);
    await render(NOTES_ASK_BEAT_MS * 3);
    expect(card()).toBeNull();
    sheet.remove();
    const box = document.createElement("textarea");
    box.setAttribute("data-test-extra", "");
    document.body.append(box);
    box.value = "half a thought";
    box.focus();
    await pass(NOTES_ASK_BEAT_MS * 3);
    expect(card()).toBeNull();
    box.value = "";
    await pass(NOTES_ASK_BEAT_MS + 300);
    expect(card()).not.toBeNull();
  });

  it("waits while the window is in the background, so the one ask is never spent unseen", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    await render(NOTES_ASK_BEAT_MS * 4);
    expect(card()).toBeNull();
    expect(puts()).toEqual([]);
    vi.mocked(document.hasFocus).mockReturnValue(true);
    await pass(NOTES_ASK_BEAT_MS + 300);
    expect(card()).not.toBeNull();
  });

  it("focuses the card, not Share summaries, so a stray Enter never says yes", async () => {
    await render();
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
    expect(document.activeElement?.hasAttribute("data-notes-yes")).toBe(false);
    expect(card()!.querySelector("[role=dialog]")!.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("Escape and a click outside both mean no", async () => {
    await render();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await settle();
    expect(card()).toBeNull();
    await act(async () => root?.unmount()); root = null;
    resetNotesAsk();
    await render();
    const scrim = document.querySelector<HTMLElement>("[data-notes-ask]")!;
    await act(async () => { scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
    await settle();
    expect(card()).toBeNull();
    expect(puts().every((body) => (body as { notes: boolean }).notes === false)).toBe(true);
  });

  it("a yes is saved after the no recorded on showing, even when that no is slow", async () => {
    f.slowNo = () => {};
    await render();
    const release = () => f.slowNo?.();
    await act(async () => { document.querySelector<HTMLButtonElement>("[data-notes-yes]")!.click(); });
    await settle();
    expect(f.done).toEqual([]);
    await act(async () => { release(); });
    await settle();
    expect(f.done).toEqual([{ notes: false }, { notes: true }]);
  });
});
