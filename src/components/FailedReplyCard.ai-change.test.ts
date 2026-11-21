import { describe, expect, it } from "vitest";
import { aiChangedSince } from "./FailedReplyCard";

describe("a failed reply's card closes once its AI changes", () => {
  it("stays under the AI it was first shown with, and closes after a model switch or connecting one's own AI", () => {
    const seen = new Map<string, string>();
    const free = { instanceId: "opencode", model: "free" };
    expect(aiChangedSince(seen, "m1", free, false)).toBe(false);
    expect(aiChangedSince(seen, "m1", free, false)).toBe(false);
    expect(aiChangedSince(seen, "m1", { instanceId: "codex", model: "gpt-6.1-sol" }, false)).toBe(true);
    expect(aiChangedSince(seen, "m2", free, false)).toBe(false);
    expect(aiChangedSince(seen, "m2", free, true)).toBe(true);
  });
});
