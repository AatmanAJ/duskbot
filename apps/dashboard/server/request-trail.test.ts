import { describe, expect, it } from "vitest";
import { SLOW_MS, traceWorthy } from "./request-trail.ts";

describe("the service's request trail", () => {
  it("leaves out quick successful session polls and keeps everything else", () => {
    expect(traceWorthy("/api/cloud/desktop/session", 200, 40)).toBe(false);
    expect(traceWorthy("/api/cloud/desktop/session?x=1", 304, 40)).toBe(false);
    expect(traceWorthy("/api/cloud/desktop/session", 401, 40)).toBe(true);
    expect(traceWorthy("/api/cloud/desktop/session", 200, SLOW_MS)).toBe(true);
    expect(traceWorthy("/api/cloud/desktop/pairing", 200, 40)).toBe(true);
    expect(traceWorthy(undefined, 200, 40)).toBe(true);
  });
});
