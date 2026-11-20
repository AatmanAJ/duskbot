import { afterEach, describe, expect, it } from "vitest";

import {
  capToolListResult, forgetToolCountLimits, learnedMcpToolBudget, learnedToolCountLimit, nextMcpToolBudget, retryUnderToolLimit, learnToolCountLimit, mcpToolBudget, shareToolBudget, toolCountLimitFromError,
} from "./tool-count-limit.ts";

afterEach(() => forgetToolCountLimits());

describe("a provider's refusal for too many tools", () => {
  it.each([
    ["OpenCode Zen", { code: -32603, message: "Internal error: Invalid value for 'tools': maximum number of items is 128.", data: { errorName: "APIError" } }, 128],
    ["OpenAI", "400 Invalid 'tools': array too long. Expected an array with maximum length 128, but got an array with length 151 instead.", 128],
    ["a wrapped detail", { message: "Internal error", data: { details: "Too many tools provided. Maximum allowed is 64" } }, 64],
    ["a count after the limit", "Request has more tools than allowed: at most 100 tools per request", 100],
  ])("names the limit (%s)", (_name, error, limit) => {
    expect(toolCountLimitFromError(error)).toBe(limit);
  });

  it.each([
    ["one tool's own field", "Invalid value for 'tools[3].function.parameters': maximum depth is 32."],
    ["a tool name's length", "Invalid 'tools[0].function.name': string too long. Expected a string with maximum length 64"],
    ["tools unsupported", "This model does not support tools. Up to 4 images are allowed."],
    ["a context limit", "This model's maximum context length is 128000 tokens."],
    ["an invalid key", { code: -32603, message: "Internal error: Invalid API key.", data: { errorName: "APIError" } }],
  ])("is not read into %s", (_name, error) => {
    expect(toolCountLimitFromError(error)).toBeUndefined();
  });
});

describe("sharing a tool budget among a turn's servers", () => {
  it("keeps a known list whole, then splits the rest evenly with the remainder to the earlier servers", () => {
    expect(Object.fromEntries(shareToolBudget([{ name: "agents", tools: 40 }, { name: "browser" }, { name: "apps" }, { name: "notes" }], 50)))
      .toEqual({ agents: 40, browser: 4, apps: 3, notes: 3 });
  });

  it("serves core servers first, each up to its ceiling, then splits the rest among apps and the person's servers", () => {
    expect(Object.fromEntries(shareToolBudget([{ name: "agents", tools: 10, core: true }, { name: "composio" }, { name: "browser", core: true },
      { name: "data", core: true }, { name: "notes" }], 104))).toEqual({ agents: 10, browser: 32, data: 32, composio: 15, notes: 15 });
    expect(Object.fromEntries(shareToolBudget([{ name: "composio" }, { name: "browser", core: true }], 13))).toEqual({ browser: 13, composio: 0 });
  });

  it("never gives out more than the budget, whatever the counts", () => {
    for (const budget of [0, 1, 7, 104]) {
      const shares = shareToolBudget([{ name: "agents", tools: 56, core: true }, { name: "a", core: true }, { name: "b" }, { name: "c", tools: 9 }], budget);
      expect([...shares.values()].reduce((sum, share) => sum + share, 0)).toBeLessThanOrEqual(budget);
    }
  });

  it("leaves the engine's own tools out of the budget", () => {
    expect(mcpToolBudget(128, 24)).toBe(104);
    expect(mcpToolBudget(16, 24)).toBe(0);
    expect(mcpToolBudget(undefined, 24)).toBeUndefined();
  });
});

describe("a capped tools/list result", () => {
  const tools = Array.from({ length: 5 }, (_, index) => ({ name: `t${index}` }));

  it("keeps the first tools in the server's order, one page only, and logs counts", () => {
    const lines: string[] = [];
    expect(capToolListResult({ tools, nextCursor: "2" }, 3, (line) => lines.push(line))).toEqual({ tools: tools.slice(0, 3) });
    expect(lines).toEqual(["listed 3 of 5 tools to fit the model's tool limit"]);
  });

  it("is the result as it came without a limit or a list", () => {
    const result = { tools, nextCursor: "2" };
    expect(capToolListResult(result, undefined)).toBe(result);
    expect(capToolListResult("x", 3)).toBe("x");
  });
});

describe("a learned limit", () => {
  it("is remembered per key", () => {
    learnToolCountLimit("a", 128);
    expect(learnedToolCountLimit("a")).toBe(128);
    expect(learnedToolCountLimit("b")).toBeUndefined();
  });

  it("halves the MCP budget each time a trimmed turn is still refused, down to none, then gives up", () => {
    const refusal = "Invalid value for 'tools': maximum number of items is 128.";
    const offered: Array<number | undefined> = [];
    let budget = learnedMcpToolBudget("k", 24);
    for (;;) {
      offered.push(budget);
      const retried = retryUnderToolLimit(refusal, { key: "k", engine: "test", offered: budget, engineTools: 24, retry: async () => {}, failed: () => {} });
      if (!retried) break;
      budget = learnedMcpToolBudget("k", 24);
    }
    expect(offered).toEqual([undefined, 104, 52, 26, 13, 6, 0]);
    expect(learnedMcpToolBudget("k", 24)).toBe(0);
    expect(nextMcpToolBudget(128, 200, 24)).toBe(104);
  });
});
