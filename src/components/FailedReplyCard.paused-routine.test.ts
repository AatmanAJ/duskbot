// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { RoutineRetry } from "@/lib/routine-retry";

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

// failures older than a day leave the card, so these rows are recent
const T0 = Date.now();

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

fixture.instances = [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as InstanceInfo];
fixture.bots = [{ id: "echo", name: "Echo", modelSelection: { instanceId: "claude", model: "sonnet" } } as Bot];

const ask: Message = { id: "ask", role: "user", kind: "text", at: T0 + 1, text: "Remind me to review the week.", routineStart: { name: "Thursday review reminder", routineId: "r1" } };
let seq = 0;
const failed = (cause: string, patch: Partial<NonNullable<Message["tool"]>> = {}): Message => ({
  id: `failed-${++seq}`, role: "bot", kind: "activity", at: T0 + 2, tool: { name: `error: ${cause}`, ok: false, ...patch },
});

let root: ReturnType<typeof createRoot> | null = null;
const show = async (message: Message, onRetry: (() => void) | undefined, routine: RoutineRetry) => {
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(createElement(FailedReplyCard, { rows: trailingRows([ask, message]), botId: "echo", threadId: "main", onRetry, routine })); });
  return [...document.querySelectorAll<HTMLButtonElement>("[data-chat-error] button:not([aria-label])")];
};
const labels = (buttons: HTMLButtonElement[]) => buttons.map((button) => button.textContent);

beforeEach(() => fixture.dispatch.mockClear());
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("a failed run of a paused routine", () => {
  it("offers Try again, which runs it once more, and says it stays paused instead of asking to turn it on", async () => {
    const onRetry = vi.fn();
    const buttons = await show(failed("claude exited 3 before result: simulated crash", { reason: "cli_exit" }), onRetry, { state: "paused", routineId: "r1", name: "Thursday review reminder" });
    expect(labels(buttons)).toEqual(["Try again", "Open routine"]);
    const note = document.querySelector("[data-routine-retry=paused]")!.textContent!;
    expect(note).toContain("Thursday review reminder");
    expect(note).not.toMatch(/turn it on/i);
    expect(note).toMatch(/leaves it paused/);
    await act(async () => buttons[0]!.click());
    expect(onRetry).toHaveBeenCalledOnce();
    await act(async () => buttons[1]!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "openRoutine", routineId: "r1", botId: "echo" }));
  });
});
