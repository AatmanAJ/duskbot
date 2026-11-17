import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, ConfigStatus, InstanceInfo } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[], config: {} as Partial<ConfigStatus> };
});
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: fixture.config, instances: fixture.instances }, dispatch: vi.fn() }) };
})(importOriginal)));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "darwin" }, localComputer: { available: true } }, ready: true }),
}));

const { ComposerSignInNotice } = await import("./ComposerSignInNotice");

const engine = (instanceId: string, displayName: string, authenticated: boolean) => ({
  instanceId, driverKind: "claudeAgent", displayName,
  snapshot: { state: "available", authenticated },
  install: { command: { darwin: "x", linux: "x", win32: "x" }, signInCommand: "claude /login" },
  authentication: { method: "paste-code" },
  models: { default: "sonnet", options: [] },
}) as unknown as InstanceInfo;
const bot = (patch: Partial<Bot> = {}) => ({ id: "echo", name: "Echo", threadId: "main", modelSelection: { instanceId: "claude", model: "sonnet" }, ...patch }) as Bot;
const show = (b: Bot) => renderToStaticMarkup(createElement(ComposerSignInNotice, { bot: b }));

beforeEach(() => {
  setLocale("en");
  fixture.instances = [engine("claude", "Claude", false), engine("codex", "Codex", true)];
  fixture.config = {};
});

describe("the sign-in notice above the composer", () => {
  it("says the bot's AI is signed out, with Sign in, before anything is sent", () => {
    const html = show(bot());
    expect(html).toContain("Claude isn&#x27;t signed in on this computer");
    expect(html).toContain("Sign in</button>");
    expect(html).toContain('role="status"');
  });

  it("stays away while the AI is signed in", () => {
    fixture.instances = [engine("claude", "Claude", true)];
    expect(show(bot())).toBe("");
  });

  it("stays away when a signed-in backup would take the turn", () => {
    expect(show(bot({ fallback: [{ instanceId: "codex", model: "gpt" }] }))).toBe("");
    fixture.config = { automaticRecovery: { enabled: true, backup: { instanceId: "codex", model: "gpt" } } };
    expect(show(bot())).toBe("");
  });

  it("still shows when the only backup is signed out too", () => {
    fixture.instances = [engine("claude", "Claude", false), engine("codex", "Codex", false)];
    expect(show(bot({ fallback: [{ instanceId: "codex", model: "gpt" }] }))).toContain("Sign in</button>");
  });

  it("is said in the reader's language", () => {
    setLocale("de");
    expect(show(bot())).not.toContain("isn&#x27;t signed in");
  });
});

describe("the free backup line above the composer", () => {
  const free = () => ({ ...engine("opencode", "OpenCode", true), driverKind: "opencode", snapshot: { state: "available", authenticated: true, freeFallback: true } }) as unknown as InstanceInfo;
  const wrote = { messages: [{ id: "u", role: "user", kind: "text", at: 1, text: "hi" }] } as Partial<Bot>;

  it("says a free backup model is answering once the person has written, with a way to connect their own", () => {
    fixture.instances = [engine("claude", "Claude", false), free()];
    const html = show(bot({ ...wrote, modelSelection: { instanceId: "opencode", model: "free" } }));
    expect(html).toContain("A free backup model from OpenCode is answering");
    expect(html).toContain("Connect your AI</button>");
    expect(show(bot({ messages: [], modelSelection: { instanceId: "opencode", model: "free" } }))).toBe("");
  });

  it("stays away while the bot answers with an AI of the person's own", () => {
    fixture.instances = [engine("claude", "Claude", true), free()];
    expect(show(bot(wrote))).toBe("");
  });
});
