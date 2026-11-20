import { describe, expect, it } from "vitest";
import { createReadCache } from "./read-cache.ts";

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("admin read cache", () => {
  it("answers a stale read at once and computes the fresh one behind it", async () => {
    let time = 0, runs = 0;
    const cache = createReadCache({ now: () => time });
    const work = async () => ++runs;
    expect(await cache.get("k", 1000, work, 10_000)).toBe(1);
    time = 500;
    expect(await cache.get("k", 1000, work, 10_000)).toBe(1);
    time = 2000;
    expect(await cache.get("k", 1000, work, 10_000), "stale, answered at once").toBe(1);
    await settle();
    expect(await cache.get("k", 1000, work, 10_000), "the refresh it started").toBe(2);
    time = 20_000;
    expect(await cache.get("k", 1000, work, 10_000), "past the stale window it waits for a new one").toBe(3);
  });
  it("keeps the older answer when a refresh fails, and never serves one from before a change", async () => {
    let time = 0, fail = false;
    const cache = createReadCache({ now: () => time });
    const work = async () => { if (fail) throw new Error("down"); return time; };
    expect(await cache.get("k", 1000, work, 10_000)).toBe(0);
    time = 2000; fail = true;
    expect(await cache.get("k", 1000, work, 10_000)).toBe(0);
    await settle();
    expect(await cache.get("k", 1000, work, 10_000)).toBe(0);
    cache.clear(); fail = false;
    expect(await cache.get("k", 1000, work, 10_000)).toBe(2000);
  });
});
