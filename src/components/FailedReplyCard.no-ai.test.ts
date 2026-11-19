// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  return { dispatch: vi.fn(), bots: [] as Bot[], instances: [] as InstanceInfo[] };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: {}, instances: fixture.instances, bots: fixture.bots }, dispatch: fixture.dispatch }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "darwin" }, localComputer: { available: true } }, ready: true }),
}));
vi.mock("./onboarding/ConnectAi", () => ({ ConnectAiDialog: () => createElement("div", { "data-connect-ai-dialog": "" }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { FailedReplyCard } = await import("./FailedReplyCard");
const { trailingRows } = await import("@/lib/failed-reply");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.now();
const free = { instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode", snapshot: { state: "available", authenticated: true, freeFallback: true } } as InstanceInfo;
const claude = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as InstanceInfo;
fixture.bots = [{ id: "echo", name: "Echo", modelSelection: { instanceId: "opencodeGo", model: "opencode/big-pickle" } } as Bot];

const ask: Message = { id: "ask", role: "user", kind: "text", at: T0 + 1, text: "hi" };
const noReply: Message = {
  id: "failed", role: "bot", kind: "activity", at: T0 + 2,
  tool: { name: "error: No free backup model answered just now, so this message got no reply.", ok: false, reason: "no_ai" },
};

let root: ReturnType<typeof createRoot> | null = null;
// the owner's 75 s wait: the turn ended on the reply watchdog, with nothing that says the free backup was the cause
const timedOut: Message = {
  id: "timed-out", role: "bot", kind: "activity", at: T0 + 2,
  tool: { name: "error: The reply timed out.", ok: false, reason: "timeout" },
};
const retry = vi.fn();
const show = async (instances: InstanceInfo[], failed: Message = noReply) => {
  fixture.instances = instances;
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(createElement(FailedReplyCard, { rows: trailingRows([ask, failed]), botId: "echo", threadId: "main", onRetry: retry })); });
  return document.querySelector("[data-chat-error]");
};
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("a first reply with no AI connected", () => {
  it("is a card to connect one: the way to connect first, a quiet try again after it", async () => {
    const card = await show([free]);
    expect(card?.textContent).toContain("Connect your AI to keep chatting");
    expect(card?.textContent).toContain("The free backup is busy right now.");
    expect(card?.textContent).not.toContain("failed to respond");
    const buttons = [...card!.querySelectorAll<HTMLButtonElement>("button:not([aria-label]):not([data-error-details-copy])")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Connect your AI", "Try again"]);
    expect(buttons[1]!.className).toContain("bg-transparent");
    await act(async () => buttons[1]!.click());
    expect(retry).toHaveBeenCalledOnce();
    await act(async () => buttons[0]!.click());
    expect(document.querySelector("[data-connect-ai-dialog]")).not.toBeNull();
  });

  it("says so when the free backup timed out, never that the bot failed or timed out", async () => {
    for (const instances of [[free], []]) {
      const card = await show(instances, timedOut);
      expect(card?.textContent).toContain("Connect your AI to keep chatting");
      expect(card?.textContent).not.toMatch(/failed|timed out/i);
      await act(async () => root?.unmount()); root = null;
    }
  });

  it("closes once an AI of the person's own is ready, since connecting one was the fix", async () => {
    expect(await show([free])).toBeTruthy();
    expect(await show([free, claude])).toBeNull();
  });
});
