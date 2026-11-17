// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  return { dispatch: vi.fn(), bots: [] as Bot[], instances: [] as InstanceInfo[], localMessage: "" };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: {}, instances: fixture.instances, bots: fixture.bots }, dispatch: fixture.dispatch }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ ready: true, capabilities: { dictation: { available: false }, host: { packaged: true, platform: "darwin" },
    localComputer: fixture.localMessage ? { available: false, message: fixture.localMessage } : { available: true } } }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { ScreenAccessNotice } = await import("./ScreenAccessNotice");
const { FailedReplyCard } = await import("./FailedReplyCard");
const { trailingRows } = await import("@/lib/failed-reply");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MISSING = "Screen Recording required for CuaDriver; turn on CuaDriver in System Settings > Privacy & Security";
const status = vi.fn(async () => ({ supported: true as const, accessibility: "granted" as const, screen: "missing" as const }));
const retry = vi.fn(async () => ({}));
const onMac: Bot = { id: "dusk", name: "dusk bot", computer: "local", modelSelection: { instanceId: "claude", model: "sonnet" } } as Bot;
fixture.bots = [onMac];
fixture.instances = [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as InstanceInfo];

let root: ReturnType<typeof createRoot> | null = null;
const render = async (element: ReturnType<typeof createElement>) => {
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(element); });
};
const actions = () => [...document.querySelectorAll<HTMLButtonElement>("[data-chat-error] button:not([aria-label])")].map((b) => b.textContent);

beforeEach(() => {
  fixture.localMessage = MISSING;
  (window as unknown as { duskDesktop: unknown }).duskDesktop = {
    platform: "darwin", macPermissions: { status, request: status }, localControl: { retry },
  };
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("screen access for a bot on this Mac", () => {
  it("says it plainly with one Allow access that opens the permissions modal, and a close", async () => {
    await render(createElement(ScreenAccessNotice, { bot: onMac }));
    expect(document.body.textContent).toContain("dusk bot needs screen access to use this Mac");
    expect(document.body.textContent).not.toMatch(/CuaDriver|Open screen/);
    expect(actions()).toEqual(["Allow access"]);
    expect(document.querySelector("[data-chat-error] button[aria-label]")).not.toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>("[data-screen-access-allow]")!.click());
    expect(document.querySelector("[data-mac-permissions-dialog]")).not.toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>("[data-mac-permissions-done]")!.click());
    expect(document.querySelector("[data-mac-permissions-dialog]")).toBeNull();
    expect(retry).toHaveBeenCalled();
  });

  it("shows nothing once access is on, or for a bot that does not work on this Mac", async () => {
    await render(createElement(ScreenAccessNotice, { bot: { ...onMac, id: "auto", computer: undefined } }));
    expect(document.querySelector("[data-screen-access]")).toBeNull();
    fixture.localMessage = "";
    await render(createElement(ScreenAccessNotice, { bot: { ...onMac, id: "granted" } }));
    expect(document.querySelector("[data-screen-access]")).toBeNull();
  });

  it("closed, it stays closed", async () => {
    await render(createElement(ScreenAccessNotice, { bot: { ...onMac, id: "closer" } }));
    await act(async () => document.querySelector<HTMLButtonElement>("[data-chat-error] button[aria-label]")!.click());
    expect(document.querySelector("[data-screen-access]")).toBeNull();
  });

  it("a turn lost to screen access before the fix shows the same card, not Open screen", async () => {
    const at = Date.now();
    const ask: Message = { id: "ask", role: "user", kind: "text", at, text: "hi" };
    const failed: Message = { id: "failed", role: "bot", kind: "activity", at: at + 1, tool: {
      name: "error: dusk bot can't use this computer yet: Screen Recording required.", ok: false,
      place: { state: "place-failed", source: "works-on", params: { bot: "dusk bot", cause: "dusk bot can't use this computer yet: Screen Recording required. Turn on CuaDriver in System Settings > Privacy & Security > Screen Recording; dusk bot notices by itself, no restart needed." } },
    } } as Message;
    await render(createElement(FailedReplyCard, { rows: trailingRows([ask, failed]), botId: "dusk", threadId: "main" }));
    expect(document.body.textContent).toContain("dusk bot needs screen access to use this Mac");
    expect(actions()).toEqual(["Allow access"]);
  });
});
