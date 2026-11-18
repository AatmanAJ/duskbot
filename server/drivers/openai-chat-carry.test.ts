import { describe, expect, it } from "vitest";
import { carriedSteps, chatLimitFacts, createCarriedWork } from "./openai-chat-carry.ts";

describe("chatLimitFacts", () => {
  it("reports a rate limit or a quota as the engine's limit, with the reset the provider named", () => {
    expect(chatLimitFacts(Object.assign(new Error("upstream HTTP 429: Rate limit reached"), { retryAfterMs: 90_000 }), 1_000)).toEqual({ limit: "engine", limitResetsAt: 91_000 });
    expect(chatLimitFacts(new Error("upstream HTTP 402: Insufficient Balance"))).toEqual({ limit: "engine" });
    expect(chatLimitFacts(new Error("upstream HTTP 429: Too Many Requests"), 1_000)).toEqual({ limit: "engine", limitResetsAt: 61_000 });
  });
  it("leaves every other failure to the turn's own error", () => {
    expect(chatLimitFacts(new Error("upstream HTTP 500: Internal Server Error"))).toBeNull();
    expect(chatLimitFacts(new Error("upstream HTTP 401: invalid api key"))).toBeNull();
  });
});

describe("carriedSteps", () => {
  const call = (id: string) => ({ id, type: "function" as const, function: { name: "write", arguments: "{}" } });
  it("keeps whole call and result pairs after the request, and stops at a call whose result never came", () => {
    const messages = [
      { role: "user", content: "earlier" },
      { role: "user", content: "do it" },
      { role: "assistant", content: null, tool_calls: [call("a")] },
      { role: "tool", tool_call_id: "a", content: "x".repeat(5_000) },
      { role: "user", content: [{ type: "image_url" }] },
      { role: "assistant", content: "next", tool_calls: [call("b")] },
    ];
    const steps = carriedSteps(messages, 1);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ role: "assistant", tool_calls: [{ id: "a" }] });
    expect(steps[1]!.content).toHaveLength(2_000);
  });
});

describe("createCarriedWork", () => {
  it("hands a conversation's steps to its next turn once, and drops them after a week and a day", () => {
    let now = 0;
    const work = createCarriedWork(() => now);
    work.keep("t", [{ role: "assistant", content: null }]);
    expect(work.take("t")).toHaveLength(1);
    expect(work.take("t")).toEqual([]);
    work.keep("t", [{ role: "assistant", content: null }]);
    now = 9 * 24 * 60 * 60_000;
    expect(work.take("t")).toEqual([]);
  });
});
