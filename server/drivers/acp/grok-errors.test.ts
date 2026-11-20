import { describe, expect, it } from "vitest";

import { acpRpcError } from "./rpc-error.ts";
import { classifyGrokError } from "./grok.ts";
import { LIMIT_WORDS } from "./quiet-status.ts";

// error frames grok 1.0.44 sent for session/prompt against a fake endpoint answering 429, 401 and 400
const RATE_LIMITED = { code: -32003, message: "Rate limited", data: "API error (status 429 Too Many Requests): rate_limit_error: You've hit the rate limit for your plan." };
const UNAUTHORIZED = { code: -32603, message: "Internal error", data: "Unauthorized (401) from https://api.x.ai/v1/responses: bad key\n\n  Model:     grok-4.7\n  Auth:      Token" };
const BAD_REQUEST = { code: -32603, message: "Internal error", data: { message: "API error (status 400 Bad Request): bad req", http_status: 400 } };

describe("grok prompt errors", () => {
  it("reads grok's spent rate limit as the plan's limit, so another AI can carry on", () => {
    const error = acpRpcError(RATE_LIMITED, "session/prompt");
    expect(classifyGrokError(error)).toBe("quota_or_region_restriction");
    expect(LIMIT_WORDS.test(error.message)).toBe(true);
  });

  it("reads a refused token as signed out", () => {
    expect(classifyGrokError(acpRpcError(UNAUTHORIZED, "session/prompt"))).toBe("invalid_credentials");
    expect(classifyGrokError(acpRpcError({ code: -32603, message: "Internal error", data: { message: "x", http_status: 401 } }, "session/prompt"))).toBe("invalid_credentials");
  });

  it("leaves other failures to the shared classifier", () => {
    expect(classifyGrokError(acpRpcError(BAD_REQUEST, "session/prompt"))).toBeUndefined();
    expect(classifyGrokError(new Error("boom"))).toBeUndefined();
  });
});
