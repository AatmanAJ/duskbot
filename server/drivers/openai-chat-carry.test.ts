import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RESUME_CAUSE, RESUME_OPENS } from "../limit-resume.ts";
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
  const resume = `${RESUME_OPENS}OpenRouter${RESUME_CAUSE} Read the conversation.]`;
  const step = [{ role: "assistant" as const, content: null }];
  it("hands the steps only to the limit hold's resume, once, and drops them after a week and a day", () => {
    let now = 0;
    const work = createCarriedWork({ now: () => now });
    work.keep("t", step);
    expect(work.take("t", resume)).toHaveLength(1);
    expect(work.take("t", resume)).toEqual([]);
    work.keep("t", step);
    now = 9 * 24 * 60 * 60_000;
    expect(work.take("t", resume)).toEqual([]);
  });
  it("clears them on any other turn there, so they never reach a later, unrelated one", () => {
    const work = createCarriedWork();
    work.keep("t", step);
    expect(work.take("t", "thanks, the backup finished it")).toEqual([]);
    expect(work.take("t", resume)).toEqual([]);
    expect(work.take("other", resume)).toEqual([]);
  });
  it("keeps them across a restart in its file, which holds nothing once they are used", () => {
    const dir = mkdtempSync(join(tmpdir(), "dusk-carry-"));
    try {
      const file = join(dir, "limit-carried-steps.json");
      createCarriedWork({ file }).keep("t", step);
      const again = createCarriedWork({ file });
      expect(again.take("t", resume)).toEqual(step);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({});
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
