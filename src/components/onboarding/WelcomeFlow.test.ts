// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { introStaged, stageIntro } from "@/lib/default-bot";
import { setLocale } from "@/lib/i18n";
import { EMPTY_ONBOARDING, MET_CHIEF_HINT, WELCOME_VERSION } from "@/lib/onboarding";
import type { InstanceInfo } from "@/state/store";
import { stopWaiting } from "@/lib/assistant-notes";

const f = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn(), onDone: vi.fn(),
  improve: [] as unknown[] }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch, refreshInstances: vi.fn(), refreshModels: vi.fn() }), api: f.api }));
vi.mock("@/state/api", () => ({ api: f.api }));
// the directory has its own tests; here only that More providers opens it
vi.mock("@/components/models/ModelDirectory", () => ({ ModelDirectory: () => null }));
vi.mock("@/lib/product-analytics", () => ({ setUsageAnalytics: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn(), setEmailGateDone: vi.fn() }));
vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));
vi.mock("@/components/mascot-clock", () => ({ usePrefersReducedMotion: () => true }));
vi.mock("@/components/EngineSetup", async (original) => {
  const { createElement: h } = await import("react");
  return { ...(await original<typeof import("@/components/EngineSetup")>()),
    EngineSetup: ({ instance }: { instance: InstanceInfo }) => h("div", { "data-engine-setup": instance.instanceId }) };
});
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
const { WelcomeFlow } = await import("./WelcomeFlow");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const claude = (ready: boolean, aiTest?: InstanceInfo["aiTest"]): InstanceInfo => ({
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", install: { docsUrl: "https://example.test" },
  snapshot: { state: ready ? "available" : "unavailable", authenticated: ready }, models: { default: "m", options: [] }, ...(aiTest ? { aiTest } : {}),
} as InstanceInfo);
const signedOut = (instanceId: string, driverKind: string, displayName: string, method = "paste-code"): InstanceInfo => ({
  instanceId, driverKind, displayName, access: "subscription", install: { docsUrl: "https://example.test" },
  snapshot: { state: "available", authenticated: false }, authentication: { method }, models: { default: "m", options: [] },
} as InstanceInfo);
const cursor = (ready: boolean): InstanceInfo => ({ ...claude(ready), instanceId: "cursor", driverKind: "cursorAgent", displayName: "Cursor", aiTest: "passed" } as InstanceInfo);
const freeOpenCode = {
  instanceId: "opencodeGo", driverKind: "opencodeGo", displayName: "OpenCode", install: { docsUrl: "https://example.test" },
  snapshot: { state: "available", authenticated: true, freeFallback: true }, models: { default: "opencode/big-pickle", options: [] }, aiTest: "passed",
} as InstanceInfo;
const nothingSignedIn = () => [signedOut("chatgpt", "codex", "ChatGPT plan", "browser-pkce"), signedOut("claude", "claudeAgent", "Claude"),
  signedOut("cursor", "cursorAgent", "Cursor", "device-code"), signedOut("githubCopilot", "copilotAgent", "GitHub Copilot", "device-code")];
const maus = { id: "maus", threadId: "t", name: "Dusk", title: "", description: "", notifications: true, color: "chrome", unread: false,
  modelSelection: { instanceId: "claude", model: "m" }, messages: [], defaultBot: {}, chiefOfStaff: true };

let host: HTMLDivElement, root: Root;
const text = () => document.body.textContent ?? "";
const step = () => document.body.querySelector<HTMLElement>("[data-welcome]")?.dataset.welcome;
const title = () => document.body.querySelector("#welcome-title")?.textContent;
const button = (label: string) => [...document.body.querySelectorAll("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label);
const press = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no "${label}" button on ${step()}: ${text()}`);
  await act(async () => { target.click(); });
  await settle();
};
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10); }); };
const key = async (name: string) => {
  await act(async () => { document.body.querySelector<HTMLElement>("[data-welcome]")!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  await settle();
};
const show = async (extra: Record<string, unknown> = {}) => {
  await act(async () => { root.render(createElement(WelcomeFlow, { onDone: f.onDone, ...extra })); });
  await settle();
};
/** An AI already answering is used without asking: the AI step says so, then goes on by itself. */
const usesFoundAi = async (name = "Claude") => {
  expect(step()).toBe("ai");
  expect(text()).toContain(`Using your ${name} account`);
  expect(document.body.querySelector("[data-funnel-ai]"), "no cards to pick from").toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_400); });
  await settle();
};
const saved = () => f.api.mock.calls.filter(([path, init]) => path === "/api/config" && init?.method === "PUT").map(([, init]) => JSON.parse(init.body));
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, String(v)), removeItem: (k: string) => void values.delete(k), clear: () => values.clear() };
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  HTMLElement.prototype.animate = vi.fn(() => ({ onfinish: null, oncancel: null, cancel() {} }) as unknown as Animation);
  setLocale("en");
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  f.dispatch.mockReset();
  f.onDone.mockReset();
  f.api.mockReset();
  f.improve = [];
  stopWaiting();
  f.api.mockImplementation(async (path: string, init?: { body?: string; method?: string }) => {
    if (path.endsWith("/check")) return { ok: true };
    if (path === "/api/dashboard/usage-signals") { if (init?.body) f.improve.push(JSON.parse(init.body)); return init?.body ? JSON.parse(init.body) : { enabled: true }; }
    if (path === "/api/mobile/devices") return { devices: [] };
    if (path === "/api/setup-import/bots") return { apps: [] };
    if (path === "/api/setup-import/grok") return { files: [], bots: [] };
    return path === "/api/instances" ? { instances: f.state.instances } : JSON.parse(init?.body ?? "{}");
  });
  f.state = { hydrated: true, instances: [claude(true, "passed")], config: { onboarding: EMPTY_ONBOARDING, profile: { name: "" } }, bots: [maus], cloudAdd: null };
  stageIntro(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the welcome", () => {
  it("opens on the welcome with nothing else to decide, and asks nothing about sharing off the desktop app", async () => {
    await show();
    expect(step()).toBe("welcome");
    expect(title()).toBe("Meet dusk bot");
    await press("Get started");
    expect(step()).toBe("ai");
    expect(document.body.querySelector("[data-help-improve]"), "Settings has the switch; the run here has no place step").toBeNull();
    expect(f.onDone).not.toHaveBeenCalled();
    expect(document.body.querySelector("textarea"), "nothing asks for a job").toBeNull();
  });

  it("first run never shows the help improve switch; it lives in Settings", async () => {
    vi.stubGlobal("duskDesktop", { remoteClient: { active: false } });
    await show();
    expect(document.body.querySelector("[data-help-improve]")).toBeNull();
    await press("Get started");
    expect(document.body.querySelector("[data-help-improve]")).toBeNull();
  });

  it("with Claude already answering, uses it without asking and goes on to Dusk's chat", async () => {
    await show();
    await press("Get started");
    await usesFoundAi();
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(introStaged("maus")).toBe(true);
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true } });
    await act(async () => {});
    expect(saved()).toEqual([{ onboarding: expect.objectContaining({ version: WELCOME_VERSION, hintsSeen: [MET_CHIEF_HINT] }) }]);
  });
});

describe("connecting an AI", () => {
  it("an AI found answering goes on at once with Continue, not only after its pause", async () => {
    await show();
    await press("Get started");
    expect(text()).toContain("Using your Claude account");
    await press("Continue");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(f.onDone, "the pause doesn't go on a second time").toHaveBeenCalledOnce();
  });

  it("while an AI is still being checked, Skip shows the cards; a check that runs out of time shows them with why", async () => {
    let fail: (error: unknown) => void = () => {};
    const base = f.api.getMockImplementation()!;
    f.api.mockImplementation((path: string, init?: { body?: string; method?: string; timeoutMs?: number }) => {
      if (path.endsWith("/check")) { expect(init?.timeoutMs).toBe(20_000); return new Promise((_, reject) => { fail = reject; }); }
      return base(path, init);
    });
    f.state = { ...f.state, instances: [claude(true, "testing")] };
    await show({ initialBeat: "ai" });
    expect(title()).toBe("Looking for an AI you already use");
    await press("Skip");
    expect(title()).toBe("Connect an AI");
    expect(document.body.querySelector("[data-funnel-ai=claude]")).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(host);
    await show({ initialBeat: "ai" });
    expect(title()).toBe("Looking for an AI you already use");
    await act(async () => { fail(new DOMException("timed out", "TimeoutError")); });
    await settle();
    expect(title()).toBe("Connect an AI");
    expect(document.body.querySelector("[data-ai-silent]"), "says Claude didn't answer, with Check again").not.toBeNull();
  });

  it("shows every AI as a button with its name, and opens the picked one's own sign-in under the grid", async () => {
    f.state = { ...f.state, instances: nothingSignedIn() };
    await show();
    await press("Get started");
    expect(step()).toBe("ai");
    expect(title()).toBe("Connect an AI");
    expect([...document.body.querySelectorAll<HTMLElement>("[data-funnel-ai]")].map((tile) => tile.dataset.funnelAi)).toEqual(["chatgpt", "claude", "cursor", "copilot"]);
    expect(text()).toContain("ChatGPT");
    f.api.mockImplementation(async (path: string) => {
      if (path === "/api/instances?fresh=1") return { instances: f.state.instances };
      if (path === "/api/instances/claude/auth/start") return { auth: { phase: "waiting", flowId: "c1", authorizationUrl: "https://claude.ai/oauth/authorize?x=1" } };
      return {};
    });
    await press("Claude");
    expect(document.body.querySelector("[data-funnel-ai-connect=claude]")).not.toBeNull();
    expect(document.body.querySelector("[data-sign-in=paste]"), "the sign-in opened in the browser, the code goes here").not.toBeNull();
    expect(f.api).toHaveBeenCalledWith("/api/instances/claude/auth/start", expect.objectContaining({ method: "POST" }));
    await press("ChatGPT");
    expect(f.api, "picking another cancels the one under way").toHaveBeenCalledWith("/api/instances/claude/auth/cancel", expect.objectContaining({ method: "POST" }));
    expect(document.body.querySelector("[data-funnel-ai-connect=claude]")).toBeNull();
    await press("More providers or use an API key");
    expect(document.body.querySelector("[data-connect-ai]")).not.toBeNull();
    expect(document.body.querySelector("[data-connect-ai] h2")?.textContent, "it opens on every other provider").toBe("More providers or use an API key");
  });

  it("shows connected AIs as connected, not to be pressed again, with continue ready and more still to add", async () => {
    f.state = { ...f.state, instances: nothingSignedIn() };
    await show();
    await press("Get started");
    expect(button("Continue")?.disabled, "nothing connected yet: Continue waits, Set up later goes on").toBe(true);
    expect(button("Set up later")?.className).not.toContain("ui-button-primary");
    expect(document.body.querySelectorAll("[data-funnel-ai-continue], [data-funnel-later]")).toHaveLength(2);
    const focus = vi.fn(async () => true);
    vi.stubGlobal("duskDesktop", { focusWindow: focus });
    f.state = { ...f.state, instances: [cursor(true), { ...claude(true), instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan" } as InstanceInfo, signedOut("claude", "claudeAgent", "Claude")] };
    await show();
    expect(title()).toBe("Connect an AI");
    const connected = [...document.body.querySelectorAll<HTMLElement>("[data-funnel-ai][data-connected]")].map((tile) => tile.dataset.funnelAi);
    expect(connected).toEqual(["chatgpt", "cursor"]);
    expect(document.body.querySelector("[data-funnel-ai=cursor]")?.tagName, "a connected AI is not a button").toBe("DIV");
    expect(document.body.querySelector("[data-funnel-ai=cursor]")?.textContent).toContain("Connected");
    expect(focus, "a sign-in that finished brings the app back").toHaveBeenCalled();
    expect(button("Set up later")).toBeUndefined();
    expect(button("Continue")?.className).toContain("ui-button-primary");
    expect(document.body.querySelector("button[data-funnel-ai=claude]"), "another can still be added").not.toBeNull();
    await press("Continue");
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
  });

  it("set up later, or the free model, goes on; a found sign-in that didn't answer says why", async () => {
    f.state = { ...f.state, instances: [freeOpenCode, ...nothingSignedIn()] };
    await show();
    await press("Get started");
    expect(button("Start with the free model"), "Set up later starts on the free model instead").toBeUndefined();
    await press("Set up later");
    expect(f.onDone).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    root = createRoot(host);
    f.onDone.mockReset();
    f.state = { ...f.state, instances: [claude(true, "failed")] };
    await show({ initialBeat: "ai" });
    expect(document.body.querySelector("[role=alert]")?.textContent).toContain("Claude");
  });
});

describe("on the desktop app", () => {
  const desktop = (extra: Record<string, unknown> = {}) => vi.stubGlobal("duskDesktop", { remoteClient: { active: false }, requireUserPresence: async () => true, ...extra });

  it("opens a server from the app on its AI, without the hello the person already saw", async () => {
    desktop({ remoteClient: { active: true } });
    await show();
    expect(step()).toBe("ai");
    expect(document.body.querySelector("[data-funnel-progress]"), "one screen has no progress to show").toBeNull();
  });

  it("opens on the hello, then the AI and the chat, with back and progress: no account, place, phone, bring or permissions", async () => {
    vi.stubEnv("VITE_DUSK_PHONE_APP", "1");
    desktop({ platform: "linux" });
    await show();
    expect(step(), "Meet dusk bot comes first").toBe("welcome");
    expect(title()).toBe("Meet dusk bot");
    await press("Get started");
    expect(step()).toBe("ai");
    expect(document.body.querySelector("[data-funnel-progress]")?.getAttribute("data-funnel-progress")).toBe("2/2");
    expect(text(), "no dusk cloud on the way in").not.toContain("dusk cloud");
    await press("Back");
    expect(step()).toBe("welcome");
    await press("Get started");
    await usesFoundAi();
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith("maus");
    expect(document.body.querySelector(".phone-frame"), "the phone is a chip in Dusk's chat, not a screen").toBeNull();
  });
  it("asks no account where the install doesn't require one: the free model needs none", async () => {
    desktop({ accountGate: { state: async () => ({ required: false, blocked: false, status: "signed-out" }), options: async () => ({ providers: ["google"], recovery: true }), onChange: () => () => {} } });
    await show();
    await press("Get started");
    expect(step()).toBe("ai");
    await act(async () => root.unmount());
    root = createRoot(host);
    await show({ initialBeat: "account" });
    expect(step(), "a run reopened on an account step it no longer has goes on to the AI").toBe("ai");
  });
  it("moves on once a browser sign-in comes back, even when the change event was missed", async () => {
    const gate = {
      status: "signed-out", listeners: [] as Array<() => void>,
      state: vi.fn(async () => ({ required: true, blocked: gate.status !== "connected", status: gate.status, ...(gate.status === "connecting" ? { browser: "google" } : {}) })),
      options: vi.fn(async () => ({ providers: ["google"], recovery: true })),
      browser: vi.fn(async () => { gate.status = "connecting"; }), cancel: vi.fn(async () => ({})),
      onChange: (listener: () => void) => { gate.listeners.push(listener); return () => {}; },
    };
    desktop({ accountGate: gate });
    await show({ initialBeat: "account" });
    await press("Continue with Google");
    expect(text()).toContain("Waiting for your browser");
    gate.status = "connected";
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await settle();
    expect(step()).toBe("ai");
  });
  it("goes back to the sign-ins when the browser didn't open, instead of waiting for it", async () => {
    desktop({ accountGate: { state: async () => ({ required: true, blocked: true, status: "signed-out" }), options: async () => ({ providers: ["google"], recovery: true }),
      browser: async () => { throw new Error("no browser"); }, onChange: () => () => {} } });
    await show({ initialBeat: "account" });
    await press("Continue with Google");
    expect(text()).not.toContain("Waiting for your browser");
    expect(button("Continue with Google")).toBeDefined();
  });

  it("shows Google and Apple with the email from the first frame, never X, and only takes away what the service doesn't offer", async () => {
    let answer: (value: { providers: string[]; recovery: boolean }) => void = () => {};
    desktop({ accountGate: { state: async () => ({ required: true, blocked: true, status: "signed-out" }), options: () => new Promise((done) => { answer = done; }), onChange: () => () => {} } });
    await show({ initialBeat: "account" });
    expect(step()).toBe("account");
    const shown = () => [...document.body.querySelectorAll("[data-funnel-provider]")].map((one) => one.getAttribute("data-funnel-provider"));
    expect(shown(), "before the service has answered").toEqual(["google", "apple"]);
    expect(document.body.querySelector("input[type=email]")).not.toBeNull();
    await act(async () => { answer({ providers: ["google", "apple", "x"], recovery: true }); });
    await settle();
    expect(shown(), "nothing moves when the service agrees, and an X it still lists is not shown").toEqual(["google", "apple"]);
  });

  it("where the install requires an account, asks for it by Google or an emailed code, and goes on once signed in", async () => {
    const gate = {
      required: true, signedIn: false,
      state: vi.fn(async () => ({ required: gate.required, blocked: !gate.signedIn, status: gate.signedIn ? "connected" : "signed-out" })),
      options: vi.fn(async () => ({ providers: ["google"], recovery: true })),
      signInStart: vi.fn(async (email: string) => ({ outcome: "sent", email, expiresAt: Date.now() + 600_000, resendAt: Date.now() + 30_000, signupOpen: true })),
      signInVerify: vi.fn(async () => { gate.signedIn = true; return { outcome: "signed-in" }; }),
      signInCancel: vi.fn(async () => {}), browser: vi.fn(async () => ({})), cancel: vi.fn(async () => ({})), reopen: vi.fn(), onChange: () => () => {},
    };
    vi.stubEnv("VITE_DUSK_PHONE_APP", "0");
    desktop({ accountGate: gate });
    await show();
    expect(step(), "the hello comes first").toBe("welcome");
    await press("Get started");
    expect(step()).toBe("account");
    expect(title()).toBe("Create your dusk bot account");
    expect(text(), "no phone in the pitch while its app is hidden").toContain("Already have one? Sign in the same way.");
    expect(text(), "no price claim in the pitch").not.toContain("Free.");
    expect(button("Continue with Google")).toBeDefined();
    expect(button("Skip for now"), "required here").toBeUndefined();
    await type(document.body.querySelector<HTMLInputElement>("input[type=email]")!, "person@example.com");
    await press("Email me a code");
    expect(gate.signInStart).toHaveBeenCalledWith("person@example.com");
    const digits = [...document.body.querySelectorAll<HTMLInputElement>("input")];
    for (const [index, digit] of digits.entries()) await type(digit, String(index + 1));
    await press("Sign in");
    expect(gate.signInVerify).toHaveBeenCalledWith("12345678");
    expect(step()).toBe("ai");
  });

  it("never offers to go on without an account where the app needs one", async () => {
    desktop({ accountGate: { state: async () => ({ required: true, blocked: true, status: "signed-out" }), options: async () => ({ providers: [], recovery: false }), onChange: () => () => {} } });
    await show();
    await press("Get started");
    expect(step()).toBe("account");
    expect(button("Skip for now")).toBeUndefined();
    await key("Escape");
    expect(step()).toBe("account");
  });

});

describe("Dusk as the Chief", () => {
  it("makes Dusk the Chief only where there is none", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }] };
    await show();
    await press("Get started");
    await usesFoundAi();
    expect(f.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "maus", patch: { welcomed: true, chiefOfStaff: true } });
  });

  it("lands on no bot where another bot is already the Chief", async () => {
    f.state = { ...f.state, bots: [{ ...maus, chiefOfStaff: false }, { ...maus, id: "research", threadId: "r", name: "Research", defaultBot: undefined, chiefOfStaff: true }] };
    await show();
    await press("Get started");
    await usesFoundAi();
    expect(f.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateBot" }));
    expect(f.onDone).toHaveBeenCalledExactlyOnceWith(null);
  });
});

describe("other first runs", () => {
  it("a replay from Settings records nothing about a first chat", async () => {
    f.state = { ...f.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-01T00:00:00.000Z", version: WELCOME_VERSION } } };
    await show({ replay: true });
    await press("Get started");
    await usesFoundAi();
    await act(async () => {});
    expect(f.onDone).toHaveBeenCalledOnce();
    expect(saved()[0].onboarding).not.toHaveProperty("hintsSeen");
    expect(introStaged("maus"), "a replay lands in a chat that may be long under way").toBe(false);
  });
});

describe("the funnel's back button", () => {
  it("starts clear of macOS's traffic lights, and in the corner elsewhere", async () => {
    const { FunnelBar } = await import("./FunnelSteps");
    const { DesktopCapabilitiesProvider } = await import("../DesktopCapabilities");
    const { cacheDesktopCapabilities, initialDesktopCapabilities } = await import("@/lib/desktop");
    const backAt = async (platform: string | null) => {
      vi.stubGlobal("duskDesktop", platform ? { platform, getCapabilities: async () => initialDesktopCapabilities() } : undefined);
      cacheDesktopCapabilities(initialDesktopCapabilities());
      await act(async () => { root.render(createElement(DesktopCapabilitiesProvider, null, createElement(FunnelBar, { at: 1, count: 3, onBack: () => {} }))); });
      await settle();
      return document.body.querySelector<HTMLElement>("[data-funnel-back]")!.getAttribute("data-funnel-back");
    };
    expect(await backAt("darwin")).toBe("clear-of-traffic-lights");
    await act(async () => root.unmount());
    root = createRoot(host);
    expect(await backAt("win32"), "Windows keeps its caption buttons on the right").toBe("");
  });
});
