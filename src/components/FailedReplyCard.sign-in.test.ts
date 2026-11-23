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
// this Mac's desktop says all it can: the card and the grid still read only the workspace's own engines
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "darwin" }, localComputer: { available: true } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

const { FailedReplyCard } = await import("./FailedReplyCard");
const { AiCards } = await import("./onboarding/AiCards");
const { trailingRows } = await import("@/lib/failed-reply");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.now();
const copilot = (authenticated: boolean): InstanceInfo => ({
  instanceId: "githubCopilot", driverKind: "copilotAgent", displayName: "GitHub Copilot", access: "subscription",
  snapshot: { state: "available", authenticated }, authentication: { methods: ["device"] },
  install: { command: { darwin: "npm install -g @github/copilot" }, docsUrl: "https://docs.github.com/en/copilot/reference/acp-server", signInCommand: "copilot login" },
} as unknown as InstanceInfo);
const ask: Message = { id: "ask", role: "user", kind: "text", at: T0 + 1, text: "hi" };
const refused: Message = {
  id: "refused", role: "bot", kind: "activity", at: T0 + 2,
  tool: { name: "error: GitHub Copilot needs you to sign in again.", ok: false, setup: true },
};

let root: ReturnType<typeof createRoot> | null = null;
const mount = async (element: ReturnType<typeof createElement>) => {
  document.body.innerHTML = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(element); });
};

beforeEach(() => {
  fixture.dispatch.mockClear();
  // the Mac's own desktop bridge is there and local; it is never asked about the workspace's AIs
  vi.stubGlobal("window", Object.assign(window, { duskDesktop: { platform: "darwin", remoteClient: { active: false } } }));
  fixture.bots = [{ id: "dusk", name: "dusk bot", modelSelection: { instanceId: "githubCopilot", model: "auto" } } as Bot];
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("a signed-out AI reads signed out everywhere, from the workspace's own engines", () => {
  it("the grid shows Copilot needing sign-in when the workspace says so, whatever the Mac has", async () => {
    fixture.instances = [copilot(false)];
    await mount(createElement(AiCards, { tested: null }));
    expect(document.querySelector('[data-funnel-ai="copilot"][data-connected]')).toBeNull();
    expect(document.querySelector('button[data-funnel-ai="copilot"]')).not.toBeNull();
  });

  it("the card's Sign in opens Connect an AI on that AI's card with nothing running, never a terminal step or Settings", async () => {
    fixture.instances = [copilot(false)];
    await mount(createElement(FailedReplyCard, { rows: trailingRows([ask, refused]), botId: "dusk", threadId: "main", onRetry: vi.fn() }));
    const card = document.querySelector("[data-chat-error]")!;
    expect(card.textContent).not.toMatch(/terminal|copilot login/i);
    const buttons = [...card.querySelectorAll<HTMLButtonElement>("button:not([aria-label])")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Sign in", "Try again"]);
    await act(async () => buttons[0]!.click());
    expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "toggleAppSettings" }));
    expect(document.querySelector("[data-ai-cards]")).not.toBeNull();
    // the person presses the card to sign in: it only takes the focus
    const copilotCard = document.querySelector<HTMLButtonElement>('button[data-funnel-ai="copilot"]')!;
    expect(copilotCard.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(copilotCard);
    expect(document.querySelector("[data-funnel-ai-connect]")).toBeNull();
  });
});

describe("a bot on the signed-out ChatGPT account while the other one is signed in", () => {
  const codex = (authenticated: boolean): InstanceInfo => ({
    instanceId: "codex", driverKind: "codex", displayName: "Codex", access: "subscription",
    snapshot: { state: "available", authenticated }, authentication: { method: "browser" },
    install: { command: { darwin: "npm install -g @openai/codex" }, docsUrl: "https://github.com/openai/codex", signInCommand: "codex login" },
    models: { default: "gpt-6.2", options: [{ id: "gpt-6.2", label: "GPT-6.2" }, { id: "gpt-6.2-sol", label: "GPT-6.2 sol" }] },
  } as unknown as InstanceInfo);
  const plan = (authenticated: boolean, options = [{ id: "gpt-6.2-sol", label: "GPT-6.2 sol" }]): InstanceInfo => ({
    instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan", access: "subscription",
    snapshot: { state: "available", authenticated, chatgptPlan: true }, authentication: { method: "browser-pkce" },
    install: { command: { darwin: "npm install -g @openai/codex" }, docsUrl: "https://github.com/openai/codex", signInCommand: "codex login" },
    models: { default: options[0]?.id ?? "", options },
  } as unknown as InstanceInfo);
  // a card is closed for good once the bot's AI changes, so each case fails a turn of its own
  let turn = 0;
  const signedOut = (): Message => ({ id: `signed-out-${++turn}`, role: "bot", kind: "activity", at: T0 + 2,
    tool: { name: "error: ChatGPT needs you to sign in again.", ok: false, setup: true } });
  const press = async (instances: InstanceInfo[], selection: Bot["modelSelection"]) => {
    vi.useFakeTimers();
    fixture.instances = instances;
    fixture.bots = [{ id: "dusk", name: "dusk bot", threadId: "main", modelSelection: selection } as Bot];
    const retry = vi.fn();
    await mount(createElement(FailedReplyCard, { rows: trailingRows([ask, signedOut()]), botId: "dusk", threadId: "main", onRetry: retry }));
    const signIn = [...document.querySelectorAll<HTMLButtonElement>("[data-chat-error] button")].find((button) => button.textContent === "Sign in")!;
    await act(async () => { signIn.click(); vi.runAllTimers(); });
    vi.useRealTimers();
    return retry;
  };

  it("Sign in moves the bot to the signed-in account on the same model and tries again, never opening a Connected dialog", async () => {
    const retry = await press([codex(true), plan(false)], { instanceId: "chatgpt", model: "gpt-6.2-sol" });
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "setModel", botId: "dusk", threadId: "main", updateBotDefault: true,
      selection: { instanceId: "codex", model: "gpt-6.2-sol" } }));
    expect(retry).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-ai-cards]")).toBeNull();
  });

  it("takes the nearest model the signed-in account offers when the same one is not there", async () => {
    await press([codex(false), plan(true, [{ id: "gpt-5.5", label: "GPT-5.5" }, { id: "gpt-6.2-sol", label: "GPT-6.2 sol" }])], { instanceId: "codex", model: "gpt-6.2" });
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "setModel", selection: { instanceId: "chatgpt", model: "gpt-6.2-sol" } }));
  });

  it("still opens Connect an AI when neither ChatGPT account is signed in", async () => {
    const retry = await press([codex(false), plan(false)], { instanceId: "chatgpt", model: "gpt-6.2-sol" });
    expect(fixture.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "setModel" }));
    expect(retry).not.toHaveBeenCalled();
    expect(document.querySelector("[data-ai-cards]")).not.toBeNull();
  });
});
