// Every driver's idle engines in one pool, the least recently used closing first once their measured memory passes the
// machine's budget for idle engines, on every machine size.
import { totalmem } from "node:os";

import { processTable, treeSize, type ProcessRow } from "../process-tree.ts";

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** What an idle engine takes until its process tree has been measured: a Claude Code 2.1 CLI with its MCP servers on the
 * host measured 220 to 330 MB on macOS arm64 (2026-11). */
export const UNMEASURED_ENGINE_BYTES = 300 * MB;
/** A quarter of the machine, within these bounds; DUSK_WARM_ENGINES_MB sets it outright. */
const BUDGET_SHARE = 0.25;
const BUDGET_MIN_BYTES = 384 * MB, BUDGET_MAX_BYTES = 8 * GB;
/** A process table read costs one `ps` (a PowerShell CIM query on Windows), so measurements are this far apart at least. */
export const MEASURE_EVERY_MS = 30_000;

export function warmBudgetBytes(totalBytes: number, env: Record<string, string | undefined> = process.env): number {
  const configured = Number(env.DUSK_WARM_ENGINES_MB);
  if (env.DUSK_WARM_ENGINES_MB !== undefined && Number.isFinite(configured) && configured > 0) return configured * MB;
  return Math.min(BUDGET_MAX_BYTES, Math.max(BUDGET_MIN_BYTES, totalBytes * BUDGET_SHARE));
}

export interface PooledEngine {
  idle: () => boolean;
  close: () => void;
  /** The engine's own process; its tree (the engine and every MCP server it started) is what it costs. */
  pid?: () => number | undefined;
}

interface Pooled {
  engine: PooledEngine;
  bytes: number | null;
}

export interface WarmPoolOptions {
  budget?: () => number;
  /** How many idle engines the box allows whatever their size (session-idle.ts: one on a small box short of memory). */
  countCap?: () => number;
  table?: () => Promise<ProcessRow[] | null>;
  now?: () => number;
  log?: (line: string) => void;
}

export class WarmPool {
  private readonly engines = new Map<string, Pooled>();
  private readonly budget: () => number;
  private readonly countCap: () => number;
  private readonly table: () => Promise<ProcessRow[] | null>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private measuredAt = -Infinity;
  private measuring: Promise<void> | null = null;

  constructor(options: WarmPoolOptions = {}) {
    this.budget = options.budget ?? (() => warmBudgetBytes(totalmem()));
    this.countCap = options.countCap ?? (() => Infinity);
    this.table = options.table ?? (() => processTable());
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** `key` went idle: it is now the most recently used, and the pool closes the longest idle past the budget. */
  add(key: string, engine: PooledEngine): void {
    const known = this.engines.get(key);
    this.engines.delete(key);
    this.engines.set(key, { engine, bytes: known?.engine === engine ? known.bytes : null });
    this.enforce(key);
    if (this.now() - this.measuredAt >= MEASURE_EVERY_MS) void this.measure();
  }

  remove(key: string): void {
    this.engines.delete(key);
  }

  keys(): string[] {
    return [...this.engines.keys()];
  }

  /** What the idle engines take, measured where they have been. */
  bytes(): number {
    let total = 0;
    for (const pooled of this.engines.values()) total += pooled.bytes ?? UNMEASURED_ENGINE_BYTES;
    return total;
  }

  /** Reads every idle engine's process tree in one table read, then applies the budget to what was measured. */
  measure(): Promise<void> {
    this.measuring ??= (async () => {
      this.measuredAt = this.now();
      const rows = await this.table().catch(() => null);
      if (!rows) return;
      for (const pooled of this.engines.values()) {
        const pid = pooled.engine.pid?.();
        if (pid === undefined) continue;
        const size = treeSize(rows, pid);
        if (size.processes) pooled.bytes = size.rssBytes;
      }
      this.enforce();
    })().finally(() => { this.measuring = null; });
    return this.measuring;
  }

  /** Closes the longest idle until the rest fit; `newest` (the engine that just went idle) is kept even alone over
   * budget, since closing it would only make its next turn start cold. */
  private enforce(newest?: string): void {
    for (const [key, pooled] of this.engines) if (key !== newest && !pooled.engine.idle()) this.engines.delete(key);
    const cap = this.countCap();
    const budget = this.budget();
    for (const [key, pooled] of this.engines) {
      if (this.engines.size <= 1 || (this.engines.size <= cap && this.bytes() <= budget)) break;
      if (key === newest) continue;
      this.engines.delete(key);
      this.log(`warm engines: closed the longest idle (${Math.round((pooled.bytes ?? UNMEASURED_ENGINE_BYTES) / MB)} MB) to keep idle engines within ${Math.round(budget / MB)} MB`);
      pooled.engine.close();
    }
  }
}
