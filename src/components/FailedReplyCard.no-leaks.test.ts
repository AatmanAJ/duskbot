// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { FailedReplyReason } from "../../shared/failed-turn";
import { rawDetailIn } from "../../shared/raw-detail";

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

fixture.instances = [{ instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", snapshot: { state: "available", authenticated: true } } as InstanceInfo];
fixture.bots = [{ id: "echo", name: "Echo", modelSelection: { instanceId: "claude", model: "sonnet" } } as Bot];

// no_ai closes by itself once the bot answers on an AI of its own, as here; its card has its own test
const REASONS: Array<FailedReplyReason | undefined> = [undefined, "signed_out", "credits", "usage_limit", "rate_limit", "overloaded", "timeout",
  "model_not_found", "bad_request", "context", "provider_down", "cli_missing", "cli_exit"];
const RAW_CAUSES = [
  "spawn claude ENOENT: /Users/sam/.duskbot/workspaces/0f6c/chats/main does not exist",
  "Error: boom\n    at runTurn (/Applications/Dusk Bot.app/Contents/Resources/server.js:12:4)",
  'API Error: 400 {"type":"error","error":{"message":"tools.3.custom.input_schema: bad"}}',
  "request to https://api.anthropic.com/v1/messages failed, reason: socket hang up",
  "codex exited with code 137",
  "This chat's working folder no longer exists: /Users/sam/Projects/launch",
];

const T0 = Date.now();
const ask: Message = { id: "ask", role: "user", kind: "text", at: T0 + 1, text: "hi" };
let seq = 0;
let root: ReturnType<typeof createRoot> | null = null;

async function show(cause: string, reason: FailedReplyReason | undefined, group: boolean, onRetry?: () => void) {
  const failed: Message = { id: `failed-${++seq}`, role: "bot", kind: "activity", at: T0 + 2, ...(group ? { from: { botId: "echo", name: "Echo", color: "blue" } } : {}),
    tool: { name: `error: ${cause}`, ok: false, ...(reason ? { reason } : {}) } };
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(createElement(FailedReplyCard, { rows: trailingRows([ask, failed]), group, botId: "echo", threadId: "main", onRetry })); });
  const card = document.querySelector("[data-chat-error]");
  return { text: card?.textContent ?? "", buttons: card ? card.querySelectorAll("button:not([aria-label])").length : 0 };
}

afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("a failure card, whatever the engine said", () => {
  it("never shows a path, an address, a stack, JSON or an exit code, and always offers a way on", async () => {
    const problems: string[] = [];
    for (const reason of REASONS) {
      for (const cause of RAW_CAUSES) {
        for (const group of [false, true]) {
          for (const onRetry of [undefined, () => {}]) {
            const { text, buttons } = await show(cause, reason, group, onRetry);
            const leak = rawDetailIn(text);
            const at = `${reason ?? "no reason"} / ${group ? "group" : "direct"} / ${onRetry ? "retry" : "no retry"} / ${cause.slice(0, 40)}`;
            if (!text) problems.push(`${at}: no card`);
            if (leak) problems.push(`${at}: shows ${leak} in "${text}"`);
            if (buttons === 0) problems.push(`${at}: no button`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("is calm and says it in one sentence in a direct chat", async () => {
    const { text } = await show("codex exited with code 137", "cli_exit", false, () => {});
    expect(text).toContain("Claude stopped before it could reply. Try again.");
    expect(text).not.toContain("failed to respond");
    expect(document.querySelector("[data-chat-error][role=status]")).not.toBeNull();
  });
});
