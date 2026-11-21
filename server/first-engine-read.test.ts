import { afterEach, describe, expect, it, vi } from "vitest";

import { FIRST_START_ENGINE_WAIT_MS, settledBefore } from "./first-engine-read.ts";

describe("settledBefore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers true once the work settles in time, resolved or rejected", async () => {
    await expect(settledBefore(Promise.resolve("done"), 1_000)).resolves.toBe(true);
    await expect(settledBefore(Promise.reject(new Error("probe failed")), 1_000)).resolves.toBe(true);
  });

  it("stops waiting on an engine read that outlasts the first start's wait, leaving it running", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const read = new Promise<void>((resolve) => (finish = resolve));
    const waited = settledBefore(read, FIRST_START_ENGINE_WAIT_MS);
    await vi.advanceTimersByTimeAsync(FIRST_START_ENGINE_WAIT_MS);
    await expect(waited).resolves.toBe(false);
    finish();
    await expect(read).resolves.toBeUndefined();
  });

  it("leaves the server most of the desktop app's minute to start listening", () => {
    expect(FIRST_START_ENGINE_WAIT_MS).toBeLessThanOrEqual(15_000);
  });
});
