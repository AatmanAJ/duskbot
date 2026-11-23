// a numbered post the relay waits for: posts stuck on a dead connection come back after the writer's 60 s timeout
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { frameQueue, GAP_MS } from "../src/app.mjs";

const epoch = "e".repeat(12);
let q, late;

beforeEach(() => {
  vi.useFakeTimers();
  late = [];
  q = frameQueue(() => {}, { bytes: 0 }, Date.now, (at, next) => late.push([at, next]));
  // the writer's first post, so the queue is past its fresh start
  q.pushInOrder(["p0"], epoch, 0);
  q.take();
});
afterEach(() => { q.close(); vi.useRealTimers(); });

describe("a gap in numbered posts", () => {
  it("waits out the writer's retry: posts that hung 60 s and were sent again still land, in order", () => {
    // posts 1-3 hang on a connection that died; 4 went out on a new one
    q.pushInOrder(["p4"], epoch, 4);
    vi.advanceTimersByTime(60_000 + 2_000);
    expect(q.take()).toEqual([]);
    for (const at of [1, 2, 3]) q.pushInOrder([`p${at}`], epoch, at);
    expect(q.take()).toEqual(["p1", "p2", "p3", "p4"]);
    expect(late).toEqual([]);
  });

  it("still waits for a retry that then waits its share of the relay", () => {
    expect(GAP_MS).toBeGreaterThanOrEqual(60_000 + 5_000 + 20_000);
    q.pushInOrder(["p2"], epoch, 2);
    vi.advanceTimersByTime(60_000 + 5_000 + 20_000);
    q.pushInOrder(["p1"], epoch, 1);
    expect(q.take()).toEqual(["p1", "p2"]);
  });

  it("is skipped once the wait is over, and only a post from the skipped stretch counts as late", () => {
    q.pushInOrder(["p3"], epoch, 3);
    vi.advanceTimersByTime(GAP_MS);
    expect(q.take()).toEqual(["p3"]);
    // a retry of post 0, queued long ago, whose answer was lost: nothing was lost
    q.pushInOrder(["p0"], epoch, 0);
    expect(late).toEqual([]);
    q.pushInOrder(["p2"], epoch, 2);
    expect(late).toEqual([[2, 4]]);
    expect(q.take()).toEqual([]);
  });

  it("ends at once when the writer starts a new epoch", () => {
    q.pushInOrder(["p2"], epoch, 2);
    q.pushInOrder(["n0"], "f".repeat(12), 0);
    expect(q.take()).toEqual(["n0"]);
    q.pushInOrder(["p1"], epoch, 1);
    expect(q.take()).toEqual([]);
    expect(late).toEqual([]);
  });
});
