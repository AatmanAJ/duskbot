// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { FailedReplyCard } = await import("./FailedReplyCard");
const { trailingRows } = await import("@/lib/failed-reply");
const { failedTurnTool } = await import("../../shared/failed-turn");

// failures older than a day leave the card, so these rows are recent
const T0 = Date.now();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
fixture.instances = [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as InstanceInfo];
fixture.bots = [{ id: "echo", name: "Echo", modelSelection: { instanceId: "claude", model: "sonnet" } } as Bot];

const ask: Message = { id: "ask", role: "user", kind: "text", at: T0 + 1, text: "book it" };
let root: ReturnType<typeof createRoot> | null = null;
const show = async (tool: NonNullable<Message["tool"]>) => {
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  const row: Message = { id: `row-${Math.random()}`, role: "bot", kind: "activity", at: T0 + 2, tool };
  await act(async () => { root!.render(createElement(FailedReplyCard, { rows: trailingRows([ask, row]), botId: "echo", threadId: "main", onRetry: vi.fn() })); });
  return [...document.querySelectorAll<HTMLButtonElement>("[data-chat-error] button:not([aria-label])")];
};

beforeEach(() => fixture.dispatch.mockClear());
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("the browser blocker card", () => {
  it("says what stuck and offers Take over, Skip and Stop", async () => {
    const buttons = await show(failedTurnTool("stopped: the same browser step did nothing 3 times on shop.example.com", { blocker: { kind: "loop", site: "shop.example.com" } }));
    expect(document.body.textContent).toContain("Stopped so it doesn't keep trying");
    expect(document.body.textContent).toContain("The same browser step did nothing 3 times in a row on shop.example.com.");
    expect(buttons.map((button) => button.textContent)).toEqual(["Take over", "Skip", "Stop"]);
    await act(async () => buttons[1]!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "send", botId: "echo", threadId: "main", text: "Skip that step and carry on with the rest." }));
    expect(document.querySelector("[data-chat-error]")).toBeNull();
  });

  it("offers no take-over where the site itself said no", async () => {
    const buttons = await show(failedTurnTool("stopped: bank.example.com was tried again", { blocker: { kind: "credentials", site: "bank.example.com" } }));
    expect(document.body.textContent).toContain("bank.example.com refused the sign-in details, so it won't try them again.");
    expect(buttons.map((button) => button.textContent)).toEqual(["Skip", "Stop"]);
  });
});
