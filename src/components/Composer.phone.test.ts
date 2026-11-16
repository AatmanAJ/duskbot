// @vitest-environment happy-dom
// The phone composer: a round + beside one pill, in Simple and Advanced mode. The buttons Advanced shows in a row
// (attach, approval level, where the bot works, Finish together) are entries of that +, and the call button is inverse.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { failedComposerSends, rememberFailedComposerSend, restoreComposerDraft } from "@/lib/drafts";
import { setCallMode } from "@/lib/call-mode";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  call: null as Record<string, unknown> | null,
  liveCall: null as unknown,
}));
const ENGINE = "claude-3f0c2b1e-9d1a-4c55-8a51-0a3a6f1e2b7c";
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [bot, peer], liveCall: fixture.liveCall, instances: [{
      instanceId: ENGINE, driverKind: "claudeAgent", displayName: "Claude", capabilities: { agentsMcp: true },
    }] },
    dispatch: fixture.dispatch,
  }) };
})(importOriginal)));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./CallView", () => ({ CallButton: (props: Record<string, unknown>) => {
  fixture.call = props;
  return null;
} }));

import { Composer } from "./Composer";

const bot: Bot = {
  id: "atlas", threadId: "atlas-thread", name: "Atlas", title: "", description: "",
  color: "purple", notifications: false, unread: false, busy: false, messages: [], approvalMode: "ask",
  modelSelection: { instanceId: ENGINE, model: "fake" },
};
const peer: Bot = { ...bot, id: "juniper", threadId: "juniper-thread", name: "Juniper", color: "teal" };
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch planning", memberIds: [bot.id, peer.id],
  defaultResponder: { kind: "member", botId: bot.id }, bulletin: "", unread: false,
  createdAt: 1, setupCompletedAt: 1, messages: [],
};

let root: Root;
let container: HTMLDivElement;
const render = (props: Parameters<typeof Composer>[0]) => flushSync(() => root.render(createElement(Composer, props)));
const plus = () => container.querySelector<HTMLElement>("[data-composer-plus]")?.closest("button") ?? null;
const menu = () => document.body.querySelector<HTMLElement>('[data-sidebar-popover-menu="anchored"]');
const item = (key: string) => document.body.querySelector<HTMLButtonElement>(`[data-menu-key="${key}"]`);
const click = (element: Element | null) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => (element as HTMLElement).click());
};
function openPlus() {
  click(plus());
  expect(menu()).not.toBeNull();
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 767.98px"), addEventListener() {}, removeEventListener() {} }));
  fixture.liveCall = null;
  setCallMode("turns");
  fixture.call = null;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  for (const id of [`bot:${bot.id}:${bot.threadId}`, `group:${room.id}:${room.threadId}`]) restoreComposerDraft(id, { text: "", attachments: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// these cover live calls, which ship behind a switch that is off
vi.stubEnv("VITE_DUSK_LIVE_CALL", "1");

describe("the phone composer", () => {
  it("with live calls off, ends the pill on an inverse mic and offers no call", () => {
    vi.stubEnv("VITE_DUSK_LIVE_CALL", "");
    try {
      render({ bot });
      expect(fixture.call).toBeNull();
      const mic = container.querySelector<HTMLButtonElement>('button[data-voice-mic="start"]')!;
      expect(mic.getAttribute("aria-label")).toBe("Start dictation");
      expect(mic.className.split(" ")).toEqual(expect.arrayContaining(["bg-ink", "text-app", "size-8", "max-md:size-10"]));
    } finally {
      vi.stubEnv("VITE_DUSK_LIVE_CALL", "1");
    }
  });

  it("shows only the + and the pill, with an inverse voice button", () => {
    render({ bot });
    expect(plus()).not.toBeNull();
    expect(fixture.call).toMatchObject({ placement: "composer", inverse: true });
    expect(fixture.call?.fill).toBeUndefined();
  });

  it("offers the photo library, the camera and files from the +, each its own picker", () => {
    render({ bot });
    openPlus();
    const keys = [...menu()!.querySelectorAll("[data-menu-key]")].map((row) => row.getAttribute("data-menu-key"));
    expect(keys.slice(0, 3)).toEqual(["attach:photos", "attach:camera", "attach"]);
    expect(item("attach:photos")?.textContent).toContain("Photo library");
    expect(item("attach:camera")?.textContent).toContain("Take photo");
    expect(item("attach")?.textContent).toContain("Files");
    const opened: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { opened.push(this); });
    click(item("attach:camera"));
    expect(opened[0]?.accept).toBe("image/*");
    expect(opened[0]?.getAttribute("capture")).toBe("environment");
    openPlus();
    click(item("attach:photos"));
    expect(opened[1]?.accept).toBe("image/*,video/*");
    expect(opened[1]?.multiple).toBe(true);
    openPlus();
    click(item("attach"));
    expect(opened[2]?.accept).toBe("");
    expect(opened[2]?.hasAttribute("capture")).toBe(false);
  });

  it("edit on a failed send puts its words back in the field, focused with the cursor at the end", async () => {
    const draftId = `bot:${bot.id}:${bot.threadId}`;
    rememberFailedComposerSend(draftId, { sendId: "lost", text: "ship it friday", requestText: "ship it friday", threadId: bot.threadId });
    render({ bot });
    expect(container.textContent).toContain("Not sent");
    click(container.querySelector("[data-failed-edit]"));
    await new Promise((done) => requestAnimationFrame(() => done(null)));
    const field = container.querySelector("textarea")!;
    expect(field.value).toBe("ship it friday");
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe("ship it friday".length);
    expect(failedComposerSends(draftId)).toEqual([]);
    expect(container.querySelector("[data-failed-send]")).toBeNull();
  });

  it("keeps one file picker on a wider screen", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: !query.includes("max-width"), addEventListener() {}, removeEventListener() {} }));
    render({ bot });
    expect(fixture.call?.inverse).toBe(false);
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(container.querySelector("input[capture]")).toBeNull();
  });
});
