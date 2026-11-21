import { describe, expect, it } from "vitest";

import type { InstanceInfo } from "@/state/store";
import { effortLevelsFor, offersReasoning } from "./model-picker-reasoning";

const engine = (capabilities: InstanceInfo["capabilities"], options: InstanceInfo["models"]["options"]) =>
  ({ instanceId: "grok", driverKind: "grok", displayName: "Grok (API)", snapshot: { state: "available" }, models: { default: options[0]!.id, options }, capabilities }) as InstanceInfo;

describe("a bot's thinking level", () => {
  it("is offered for every model of an engine that takes one", () => {
    const claude = engine({ effortLevels: ["low", "high"] }, [{ id: "opus", label: "Opus" }]);
    expect(effortLevelsFor(claude, "opus")).toEqual(["low", "high"]);
  });

  it("is offered only on the models that think where the engine says so per model", () => {
    const grok = engine({ effortLevels: ["low", "medium", "high", "xhigh"], effortByModel: true }, [
      { id: "grok-4.7", label: "Grok 4.7", effortLevels: ["low", "medium", "high", "xhigh"] },
      { id: "grok-4-fast", label: "Grok 4 Fast" },
    ]);
    expect(effortLevelsFor(grok, "grok-4.7")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(effortLevelsFor(grok, "grok-4-fast")).toBeUndefined();
    const state = { instances: [grok], modelVariantSessions: {} };
    expect(offersReasoning(state, grok, { instanceId: "grok", model: "grok-4.7" }, undefined)).toBe(true);
    expect(offersReasoning(state, grok, { instanceId: "grok", model: "grok-4-fast" }, undefined)).toBe(false);
  });
});
