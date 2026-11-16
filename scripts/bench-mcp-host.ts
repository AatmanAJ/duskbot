// Warm engines' cost: an isolated fixture server with the fake Claude engine, which connects every MCP server of its
// launch and keeps them as the real CLI does (FAKE_CLAUDE_MCP_STARTUP). For 1, 5 and 10 warm threads (one bot each),
// the server's whole process tree is counted and its resident memory summed once every turn has settled, and each
// thread's first (cold) turn is timed. Every warm engine must still be up, and every MCP server it was given must have
// listed its tools: the same servers and tools as BENCH_SURFACE's reference, so a change can't win by mounting less.
// --scope '<tool selection JSON>' gives every bot that selection, so harness servers run behind tool-selection gates.
// Run: node --experimental-strip-types scripts/bench-mcp-host.ts [--record-surface] [--counts 1,5,10] [--scope JSON] [--json]
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { launchVerificationServer, runControlDusk } from "./control-dusk.ts";
import { processTable, treeSize } from "../server/process-tree.ts";

const args = process.argv.slice(2);
const flagValue = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const COUNTS = (flagValue("--counts") ?? "1,5,10").split(",").map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
const SURFACE_FILE = process.env.BENCH_SURFACE ?? join(import.meta.dirname, "bench-mcp-host.surface.json");
const RECORD = args.includes("--record-surface");
const SCOPE = flagValue("--scope") === undefined ? undefined : JSON.parse(flagValue("--scope")!) as unknown;
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS ?? 1_500);
const MB = 1024 * 1024;

type StartupLine = { pid: number; server: string; ok: boolean; tools?: string[]; transport: string; error?: string };
type Scenario = { threads: number; processes: number; rssMb: number; coldMs: number[]; surface: Record<string, string[]>; transports: Record<string, string> };

const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]! : 0;

async function json(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", origin: new URL(url).origin, ...init.headers } });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${new URL(url).pathname}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

async function scenario(threads: number): Promise<Scenario> {
  const scratch = mkdtempSync(join(tmpdir(), "dusk-bench-mcp-host-"));
  const startupLog = join(scratch, "startup.jsonl");
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_MCP_STARTUP: "1",
    FAKE_CLAUDE_MCP_STARTUP_LOG: startupLog,
    FAKE_CLAUDE_TOOL_CALLS: "[]",
    FAKE_CLAUDE_REPLIES: JSON.stringify(["Ready."]),
  });
  const url = fixture.info.url;
  try {
    const [starter] = (await json(`${url}/api/bots`)).bots as Array<{ id: string }>;
    const bots = [starter!.id];
    for (let i = 1; i < threads; i++) {
      bots.push((await json(`${url}/api/bots`, { method: "POST", body: JSON.stringify({ useDefaults: false, name: `Bench ${i}` }) })).bot.id);
    }
    if (SCOPE !== undefined) {
      for (const bot of bots) await json(`${url}/api/bots/${bot}`, { method: "PATCH", body: JSON.stringify({ toolScope: SCOPE }) });
    }
    const coldMs = await Promise.all(bots.map(async (bot, i) => {
      const started = performance.now();
      await runControlDusk(["send", "--bot", bot, "--text", `Warm up ${i}.`, "--url", url]);
      const waited = await runControlDusk(["wait", "--bot", bot, "--for", "turn", "--timeout", "120", "--url", url]) as { status?: string };
      if (waited?.status !== "settled") throw new Error(`bot ${bot}'s turn did not settle: ${JSON.stringify(waited)}`);
      return performance.now() - started;
    }));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const rows = await processTable();
    if (!rows) throw new Error("the process table could not be read");
    const size = treeSize(rows, fixture.info.pid);
    const lines: StartupLine[] = existsSync(startupLog)
      ? readFileSync(startupLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as StartupLine) : [];
    const engines = new Set(lines.map((line) => line.pid));
    const alive = [...engines].filter((pid) => rows.some((row) => row.pid === pid));
    if (engines.size !== threads || alive.length !== threads) {
      throw new Error(`expected ${threads} warm engines, saw ${engines.size} launched and ${alive.length} still up`);
    }
    const failed = lines.filter((line) => !line.ok);
    if (failed.length) throw new Error(`MCP servers failed to start: ${failed.map((line) => `${line.server} (${line.error})`).join(", ")}`);
    const first = lines.filter((line) => line.pid === lines[0]!.pid);
    const surface = Object.fromEntries(first.map((line) => [line.server, line.tools ?? []]).sort(([a], [b]) => String(a).localeCompare(String(b))));
    for (const pid of engines) {
      const own = Object.fromEntries(lines.filter((line) => line.pid === pid).map((line) => [line.server, line.tools ?? []]));
      const sameServers = JSON.stringify(Object.keys(own).sort()) === JSON.stringify(Object.keys(surface));
      if (!sameServers) throw new Error(`engine ${pid} mounted ${Object.keys(own).sort().join(",")}, not ${Object.keys(surface).join(",")}`);
    }
    const transports = Object.fromEntries(first.map((line) => [line.server, line.transport]));
    return { threads, processes: size.processes, rssMb: size.rssBytes / MB, coldMs, surface, transports };
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const results: Scenario[] = [];
  for (const threads of COUNTS) results.push(await scenario(threads));
  const surface = results[0]!.surface;
  const digest = createHash("sha256").update(JSON.stringify(surface)).digest("hex").slice(0, 16);
  if (RECORD) writeFileSync(SURFACE_FILE, `${JSON.stringify(surface, null, 2)}\n`);
  else if (existsSync(SURFACE_FILE)) {
    const reference = JSON.parse(readFileSync(SURFACE_FILE, "utf8")) as Record<string, string[]>;
    if (JSON.stringify(reference) !== JSON.stringify(surface)) {
      throw new Error(`each thread's MCP tools differ from ${SURFACE_FILE}:\nwant ${JSON.stringify(reference)}\ngot  ${JSON.stringify(surface)}`);
    }
  }
  for (const result of results) {
    console.log(`${String(result.threads).padStart(2)} warm threads: ${String(result.processes).padStart(3)} processes, ${result.rssMb.toFixed(0).padStart(5)} MB RSS, cold turn median ${median(result.coldMs).toFixed(0)} ms`);
  }
  console.log(`servers per thread: ${Object.entries(results[0]!.transports).map(([name, transport]) => `${name}(${transport})`).join(" ")} · tools digest ${digest}`);
  const processes = results.reduce((sum, result) => sum + result.processes, 0);
  const rssMb = results.reduce((sum, result) => sum + result.rssMb, 0);
  if (args.includes("--json")) console.log(JSON.stringify({ results: results.map((result) => ({ threads: result.threads, processes: result.processes, rssMb: result.rssMb, coldMs: result.coldMs })), processes, rssMb }));
  console.log(`total: ${processes} processes, ${rssMb.toFixed(0)} MB`);
  // The score weighs both halves equally against the code before this work (bench-mcp-host.baseline.json): 100 is no change.
  const baselineFile = process.env.BENCH_BASELINE ?? join(import.meta.dirname, "bench-mcp-host.baseline.json");
  if (existsSync(baselineFile)) {
    const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as { processes: number; rssMb: number };
    console.log(`score ${(50 * processes / baseline.processes + 50 * rssMb / baseline.rssMb).toFixed(2)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
