import { describe, expect, it } from "vitest";

import type { ProcessRow } from "../process-tree.ts";
import { MEASURE_EVERY_MS, UNMEASURED_ENGINE_BYTES, WarmPool, warmBudgetBytes } from "./warm-pool.ts";

const MB = 1024 * 1024;
const GB = 1024 * MB;

function engine(pid?: number, busy = false) {
  const state = { busy, closed: 0 };
  return { state, warm: { idle: () => !state.busy, close: () => { state.closed += 1; }, ...(pid === undefined ? {} : { pid: () => pid }) } };
}

/** A process table where engine `pid` leads a tree of `mb` MB: the engine and one MCP child. */
function table(trees: Record<number, number>): ProcessRow[] {
  return Object.entries(trees).flatMap(([pid, mb]) => [
    { pid: Number(pid), ppid: 1, rssBytes: (mb / 2) * MB, name: "claude" },
    { pid: Number(pid) + 1, ppid: Number(pid), rssBytes: (mb / 2) * MB, name: "node" },
  ]);
}

describe("the warm engine pool", () => {
  it("budgets a quarter of the machine, within bounds, or what DUSK_WARM_ENGINES_MB says", () => {
    expect(warmBudgetBytes(16 * GB, {})).toBe(4 * GB);
    expect(warmBudgetBytes(128 * GB, {})).toBe(8 * GB);
    expect(warmBudgetBytes(1 * GB, {})).toBe(384 * MB);
    expect(warmBudgetBytes(16 * GB, { DUSK_WARM_ENGINES_MB: "900" })).toBe(900 * MB);
    for (const raw of ["0", "-5", "lots", ""]) expect(warmBudgetBytes(16 * GB, { DUSK_WARM_ENGINES_MB: raw })).toBe(4 * GB);
  });

  it("counts an engine it has not measured at the default size", () => {
    const pool = new WarmPool({ budget: () => Infinity, table: async () => [], log: () => {} });
    pool.add("a", engine().warm);
    pool.add("b", engine().warm);
    expect(pool.bytes()).toBe(2 * UNMEASURED_ENGINE_BYTES);
  });

  it("measures each idle engine's whole process tree and closes the longest idle past the budget, on any machine", async () => {
    let now = 0;
    const rows = table({ 100: 400, 200: 400, 300: 400 });
    const logged: string[] = [];
    const pool = new WarmPool({ budget: () => 1000 * MB, table: async () => rows, now: () => now, log: (line) => logged.push(line) });
    const [a, b, c] = [engine(100), engine(200), engine(300)];
    pool.add("a", a.warm);
    await pool.measure();
    now += 1_000;
    pool.add("b", b.warm);
    now += 1_000;
    pool.add("c", c.warm);
    expect([a.state.closed, b.state.closed, c.state.closed]).toEqual([0, 0, 0]);
    await pool.measure();
    expect(pool.keys()).toEqual(["b", "c"]);
    expect([a.state.closed, b.state.closed, c.state.closed]).toEqual([1, 0, 0]);
    expect(pool.bytes()).toBe(800 * MB);
    expect(logged.join("\n")).toMatch(/closed the longest idle \(400 MB\).*1000 MB/);
  });

  it("keeps the engine that just went idle even when it alone is over budget", () => {
    const pool = new WarmPool({ budget: () => 1, table: async () => [], log: () => {} });
    const [a, b] = [engine(), engine()];
    pool.add("a", a.warm);
    pool.add("b", b.warm);
    expect(pool.keys()).toEqual(["b"]);
    expect([a.state.closed, b.state.closed]).toEqual([1, 0]);
  });

  it("never closes a busy engine; it leaves the pool instead, and comes back as the newest", () => {
    const pool = new WarmPool({ budget: () => UNMEASURED_ENGINE_BYTES, table: async () => [], log: () => {} });
    const a = engine(undefined, true);
    const b = engine();
    pool.add("a", a.warm);
    pool.add("b", b.warm);
    expect(a.state.closed).toBe(0);
    expect(pool.keys()).toEqual(["b"]);
    a.state.busy = false;
    pool.add("a", a.warm);
    expect(pool.keys()).toEqual(["a"]);
    expect(b.state.closed).toBe(1);
  });

  it("honours a count cap whatever the engines measure", () => {
    const pool = new WarmPool({ budget: () => Infinity, countCap: () => 1, table: async () => [], log: () => {} });
    const [a, b] = [engine(), engine()];
    pool.add("a", a.warm);
    pool.add("b", b.warm);
    expect(pool.keys()).toEqual(["b"]);
  });

  it("reads the process table at most once in a while, and once for every engine", async () => {
    let now = 0;
    let reads = 0;
    const pool = new WarmPool({ budget: () => Infinity, table: async () => { reads += 1; return table({ 10: 100, 20: 100 }); }, now: () => now, log: () => {} });
    pool.add("a", engine(10).warm);
    pool.add("b", engine(20).warm);
    // The read the first add started is still in flight: asking again joins it.
    await pool.measure();
    expect(reads).toBe(1);
    now += MEASURE_EVERY_MS - 1;
    pool.add("a", engine(10).warm);
    expect(reads).toBe(1);
    now += 1;
    pool.add("b", engine(20).warm);
    await new Promise((resolve) => setImmediate(resolve));
    expect(reads).toBe(2);
  });

  it("keeps an engine's measured size when a process table can't be read", async () => {
    let rows: ProcessRow[] | null = table({ 10: 200 });
    const pool = new WarmPool({ budget: () => Infinity, table: async () => rows, log: () => {} });
    const a = engine(10).warm;
    pool.add("a", a);
    await pool.measure();
    rows = null;
    await pool.measure();
    expect(pool.bytes()).toBe(200 * MB);
  });
});
