import { describe, expect, it } from "vitest";
import { intendedModel, namesUnknownModel, unavailableModelMessage } from "./model-intent.ts";
import { failedReplyReason } from "../failed-reply-reason.ts";

describe("intendedModel", () => {
  it("finds the one listed model a refused name clearly means", () => {
    expect(intendedModel("meta-llama/llama-3.3-70b-instruct", ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"])).toBe("llama-3.3-70b-versatile");
    expect(intendedModel("deepseek/deepseek-chat-v3:free", ["deepseek-chat-v3", "deepseek-reasoner"])).toBe("deepseek-chat-v3");
    expect(intendedModel("Qwen/Qwen3-32B", ["qwen3-32b"])).toBe("qwen3-32b");
  });

  it("guesses nothing when the server has the name, when two models match, or when none does", () => {
    expect(intendedModel("gpt-6", ["gpt-6", "gpt-6-mini"])).toBeUndefined();
    expect(intendedModel("llama-3.3-70b", ["meta/llama-3.3-70b-instruct", "groq/llama-3.3-70b-versatile"])).toBeUndefined();
    expect(intendedModel("meta-llama/llama-3.3-70b-instruct", ["gpt-6", "glm-5.3"])).toBeUndefined();
    expect(intendedModel("", ["gpt-6"])).toBeUndefined();
  });
});

describe("a model the server does not have", () => {
  it("is recognised in the providers' words and reads as a model to switch", () => {
    expect(namesUnknownModel(new Error("upstream HTTP 404: No endpoints found for x."))).toBe(true);
    expect(namesUnknownModel(new Error("upstream HTTP 400: Model Not Exist"))).toBe(true);
    expect(namesUnknownModel(new Error("upstream HTTP 429: Rate limit exceeded"))).toBe(false);
    const message = unavailableModelMessage("meta-llama/llama-3.3-70b-instruct", ["a", "b", "c", "d", "e", "f"]);
    expect(message).toContain('"a", "b", "c", "d", "e"');
    expect(message).not.toContain('"f"');
    expect(failedReplyReason(message, {})).toBe("model_not_found");
    expect(failedReplyReason(unavailableModelMessage("", []), {})).toBe("model_not_found");
  });
});
