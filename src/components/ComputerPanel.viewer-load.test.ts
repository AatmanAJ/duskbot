// @vitest-environment happy-dom
import { Component, createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: undefined }),
  useDesktopCapabilities: () => ({
    ready: true,
    capabilities: {
      host: { platform: "darwin", label: "Host", session: "unknown", packaged: true, homeDir: "/Users/me" },
      windowChrome: "native",
      screenPreview: { available: false, interaction: "none" },
      dictation: { available: false, engine: "none", onDevice: false },
      localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
    },
  }),
}));
vi.mock("./BrowserPanel", () => ({ BrowserPanel: () => null }));
vi.mock("./bot-settings/RoutinesSection", () => ({ RoutinesSection: () => null }));
// the screen viewer's code never arrives, as when a dev server re-bundles under a running window
vi.mock("./LiveDesktop", () => { throw new TypeError("Failed to fetch dynamically imported module: /src/components/LiveDesktop.tsx"); });
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: async (path: string) => {
    if (path.startsWith("/api/bots/bot/computer/screenshot")) return { png: "POLLED", format: "png" };
    if (path.startsWith("/api/bots/bot/computer/control")) return { held: false, helpReason: null };
    if (path.startsWith("/api/bots/bot/computer?")) return { surface: "cloud", backend: "vps", configured: true, ready: true, managed: true, imageMatches: true, container: "running" };
    return {};
  },
}));

const { ComputerPanel } = await import("./ComputerPanel");
const { BotEditorStore, initialState } = await import("@/state/store");

const bot = {
  id: "bot", threadId: "thread", name: "Fixture", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, computer: "cloud", messages: [],
  modelSelection: { instanceId: "claude", model: "m" },
  tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask" }],
} as unknown as Bot;
const engine = {
  instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude", access: "subscription",
  snapshot: { state: "available", version: "1", authenticated: true },
  models: { default: "m", options: [{ id: "m", label: "M" }] },
  capabilities: { computerMcp: true, browserMcp: true },
} as InstanceInfo;

class Catch extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() { return this.state.error ? createElement("p", { "data-crashed": "" }) : this.props.children; }
}

let root: Root;
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeAll(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  const state: AppState = { ...initialState, hydrated: true, bots: [bot], instances: [engine], config: { vps: { configured: true } } as AppState["config"] };
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(Catch, null, createElement(BotEditorStore, { value, children: createElement(ComputerPanel, { bot, inline: true }) }))));
  await settle();
});
afterAll(() => root.unmount());

describe("the computer's screen when the viewer's code cannot load", () => {
  it("never takes the panel down, and shows the computer in pictures instead", async () => {
    expect(document.querySelector("[data-crashed]")).toBeNull();
    await expect.poll(() => document.querySelector("[data-inline-computer] img")?.getAttribute("src")).toBe("data:image/png;base64,POLLED");
    expect(document.querySelector("[data-inline-computer]")?.getAttribute("data-stage")).toBe("screen");
  });
});
