import { describe, expect, it } from "vitest";

import { ApiError } from "@/state/api";
import { keepsNone } from "./synced-prefs";

describe("synced preferences", () => {
  it("stop asking a place that keeps no one's preferences, or a computer whose bots moved, and keep asking after a passing refusal", () => {
    expect(keepsNone(new ApiError("no", 403))).toBe(true);
    expect(keepsNone(new ApiError("no", 404))).toBe(true);
    expect(keepsNone(new ApiError("moved", 409, { error: "Your bots live on My Cloud now.", code: "moved" }))).toBe(true);
    expect(keepsNone(new ApiError("busy", 409, { error: "busy" }))).toBe(false);
    expect(keepsNone(new ApiError("down", 503))).toBe(false);
    expect(keepsNone(new TypeError("fetch failed"))).toBe(false);
  });
});
