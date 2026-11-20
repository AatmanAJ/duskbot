// Each benchmark task's scripted way through passes its check on real Chrome, and doing nothing fails it.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "../testing/host-timeout.ts";
import { CHROME } from "../browser/cdp/testing/real-chrome.ts";
import { startService, type RealService } from "../browser/testing/real-service.ts";
import { BenchSite } from "./site.ts";
import { TASKS } from "./tasks.ts";

const suite = CHROME ? describe : describe.skip;
const only = (process.env.BENCH_ONLY ?? "").split(",").filter(Boolean);

suite("browser benchmark fixtures on real Chrome", () => {
  let site: BenchSite;
  let real: RealService;
  let runs = 0;
  const folders: string[] = [];

  beforeAll(async () => {
    site = await BenchSite.start(TASKS);
    real = await startService();
  }, hostTimeout(240_000));

  afterAll(async () => {
    await real?.close();
    await site?.close();
    for (const folder of folders) rmSync(folder, { recursive: true, force: true });
  });

  for (const task of TASKS.filter((t) => !only.length || only.includes(t.id))) {
    it(`${task.id}: the scripted way through passes, doing nothing fails`, async () => {
      const files = mkdtempSync(join(tmpdir(), "bench-files-"));
      folders.push(files);
      for (const [name, contents] of Object.entries(task.files ?? {})) writeFileSync(join(files, name), contents);
      expect(task.check(site.newRun(task.id), "").pass).toBe(false);
      const run = site.newRun(task.id);
      const target = { session: `bench-${++runs}`, key: `bot:bench-${runs}` };
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await real.call(target, name, args);
        const text = real.text(result);
        if (result.isError) throw new Error(`${name} ${JSON.stringify(args)}: ${text}`);
        return text;
      };
      const answer = await task.solve(call, { base: site.base(run), cross: site.cross(run), files });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(task.check(run, answer), JSON.stringify(run.events)).toMatchObject({ pass: true });
    }, hostTimeout(90_000));
  }
});
