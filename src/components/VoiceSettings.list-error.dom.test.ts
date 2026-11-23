// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  api: vi.fn(),
  config: { tts: { configured: true, provider: "elevenlabs", voice: "" } } as Record<string, unknown>,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { config: fixture.config }, dispatch: vi.fn() }),
}));

const { VoiceSettings } = await import("./VoiceSettings");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pepper: Bot = {
  id: "pepper", threadId: "t", name: "Pepper", title: "", description: "", color: "orange",
  notifications: true, unread: false, messages: [], modelSelection: { instanceId: "codex", model: "m" },
};

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); fixture.api.mockReset(); });

it("a voice list that could not be fetched says so, instead of an empty picker", async () => {
  fixture.api.mockRejectedValue(new Error("ElevenLabs didn't answer."));
  await act(async () => root.render(createElement(VoiceSettings, { bot: pepper, onPatch: vi.fn() })));
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(fixture.api).toHaveBeenCalledWith(expect.stringContaining("/api/tts/voices"));
  expect(host.querySelector("[role=alert]")?.textContent).toBeTruthy();
});
