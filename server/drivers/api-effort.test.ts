import { describe, expect, it } from "vitest";

import { geminiEffortLevels, openAiEffortLevels, xaiEffortLevels } from "./api-effort.ts";
import { responsesRequest } from "./openai-responses.ts";

describe("thinking levels on API models", () => {
  it("offers levels on OpenAI's reasoning models only", () => {
    expect(openAiEffortLevels("gpt-5")).toEqual(["low", "medium", "high"]);
    expect(openAiEffortLevels("gpt-5-mini")).toEqual(["low", "medium", "high"]);
    expect(openAiEffortLevels("o4-mini")).toEqual(["low", "medium", "high"]);
    expect(openAiEffortLevels("gpt-5-chat-latest")).toBeUndefined();
    expect(openAiEffortLevels("gpt-4.1")).toBeUndefined();
  });

  it("offers levels on Gemini 2.5 and later only", () => {
    expect(geminiEffortLevels("gemini-2.5-flash")).toEqual(["low", "medium", "high"]);
    expect(geminiEffortLevels("models/gemini-3-pro-preview")).toEqual(["low", "medium", "high"]);
    expect(geminiEffortLevels("gemini-2.0-flash")).toBeUndefined();
  });

  it("offers xAI's levels where its API takes them", () => {
    expect(xaiEffortLevels("grok-4.7")).toEqual(["low", "medium", "high", "xhigh"]);
    expect(xaiEffortLevels("grok-4.5")).toEqual(["low", "medium", "high"]);
    expect(xaiEffortLevels("grok-3-mini")).toEqual(["low", "high"]);
    expect(xaiEffortLevels("grok-4")).toBeUndefined();
    expect(xaiEffortLevels("grok-4-fast")).toBeUndefined();
  });

  it("puts the level beside reasoning summaries on a Responses call", () => {
    const base = { model: "gpt-5", messages: [], tools: [], replay: () => undefined };
    expect(responsesRequest({ ...base, summaries: true, effort: "high" }).reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(responsesRequest({ ...base, summaries: false, effort: "low" }).reasoning).toEqual({ effort: "low" });
    expect(responsesRequest({ ...base, summaries: false })).not.toHaveProperty("reasoning");
  });
});
