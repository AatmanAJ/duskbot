import { describe, expect, it } from "vitest";
import { aiName, aiTiles, freeModel, funnelSteps, nextStep, previousStep } from "./funnel";

const ai = (instanceId: string, driverKind: string, ready = false, extra: Record<string, unknown> = {}) => ({
  instanceId, driverKind, displayName: instanceId, access: "subscription", snapshot: { state: ready ? "available" : "unavailable", ...extra },
});
const ready = (instance: { snapshot: { state: string } }) => instance.snapshot.state === "available";

describe("the funnel's steps", () => {
  it("on the desktop app: the hello, an AI, then the chat; no account, place, phone, bring or permissions", () => {
    const steps = funnelSteps({ account: true, desktop: true });
    expect(steps).toEqual(["welcome", "ai"]);
    expect(nextStep(steps, "welcome")).toBe("ai");
    expect(nextStep(steps, "ai"), "the chat comes after the AI").toBeNull();
    expect(previousStep(steps, "ai")).toBe("welcome");
  });

  it("asks for an account on the desktop app only where the install requires one", () => {
    expect(funnelSteps({ account: true, accountRequired: true, desktop: true })).toEqual(["welcome", "account", "ai"]);
    expect(funnelSteps({ account: false, accountRequired: true, desktop: true })).toEqual(["welcome", "ai"]);
  });

  it("asks for an account in a window that isn't the desktop app's own, where there is none yet", () => {
    expect(funnelSteps({ account: true, desktop: false })).toEqual(["welcome", "account", "ai"]);
    expect(funnelSteps({ account: false, desktop: false })).toEqual(["welcome", "ai"]);
  });

  it("skips the hello on a server opened from the desktop app, where the person already met dusk bot", () => {
    expect(funnelSteps({ account: false, desktop: false, hello: false })).toEqual(["ai"]);
  });

  it("on a cloud the desktop app set up: the hello, an AI, and that computer's bots when it has some", () => {
    expect(funnelSteps({ account: false, desktop: false, cloudBring: true })).toEqual(["welcome", "ai", "bring"]);
  });
});

describe("the AI grid", () => {
  it("names each AI as people know it, in a fixed order, with only the ones this app can connect", () => {
    const tiles = aiTiles([ai("claude", "claudeAgent"), ai("chatgpt", "codex"), ai("antigravity", "antigravityAgent"), ai("openrouter", "openai-compat")], ready);
    expect(tiles.map((tile) => [tile.id, tile.label, tile.instance.instanceId])).toEqual([
      ["chatgpt", "ChatGPT", "chatgpt"], ["claude", "Claude", "claude"], ["gemini", "Gemini", "antigravity"], ["openrouter", "OpenRouter", "openrouter"],
    ]);
    expect(aiName({ instanceId: "chatgpt", driverKind: "codex", displayName: "ChatGPT plan" })).toBe("ChatGPT");
    expect(aiName({ instanceId: "kimi", driverKind: "kimiAgent", displayName: "Kimi" })).toBe("Kimi");
  });

  it("lets a signed-in one stand for its tile", () => {
    const tiles = aiTiles([ai("chatgpt", "codex"), ai("codex", "codex", true)], ready);
    expect(tiles[0]!.instance.instanceId).toBe("codex");
  });

  it("offers the free model only when it is ready", () => {
    expect(freeModel([ai("opencodeGo", "opencodeGo", true, { freeFallback: true })], ready)?.instanceId).toBe("opencodeGo");
    expect(freeModel([ai("opencodeGo", "opencodeGo", false, { freeFallback: true })], ready)).toBeUndefined();
  });
});
