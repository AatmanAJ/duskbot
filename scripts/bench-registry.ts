#!/usr/bin/env -S node --experimental-strip-types
// The bot registry and its live stream, on isolated fixtures only (a temporary HOME and data folder, the fake engine):
//   micro  lookups (bot, botByThread, groupByThread) and the time a thread change takes to save, on a large registry
//   live   bytes the desktop's live stream carries and the harness CPU while 8 threads stream replies at once
//   node --experimental-strip-types scripts/bench-registry.ts [--part micro|live|all] [--json FILE] [--rounds 2]
// Prints one JSON object per part, then a score line: the summed log distance of each measure from its bar (0 = every
// bar met), plus the log of any measure that grew past its baseline.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    part: { type: "string", default: "all" },
    json: { type: "string" },
    rounds: { type: "string", default: "2" },
    "micro-child": { type: "boolean", default: false },
    bots: { type: "string", default: "30" },
    tasks: { type: "string", default: "100" },
  },
});
const log = (line: string) => process.stderr.write(`bench-registry: ${line}\n`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (samples: number[]) => { const sorted = [...samples].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : NaN; };
const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Measured on this branch's base (main at dbfefd93d, Apple M-series, Node 26) and the bars this work aims at. */
const BASELINE = { liveBytes: 2_738_000, harnessCpuMs: 820, lookupNs: 4_300, saveMs: 5.7 };
const BARS = { liveBytes: 456_000, harnessCpuMs: 512, lookupNs: 430, saveMs: 0.95 };

/** A registry shaped like a busy workspace: `bots` bots with `tasks` threads each, and rooms with their own threads. */
function registryRecords(bots: number, tasks: number, now: number) {
  const word = (n: number) => ["sync", "report", "draft", "review", "plan", "fix", "notes", "deploy", "audit", "call"][n % 10]!;
  return Array.from({ length: bots }, (_, b) => {
    const id = `bench-bot-${b.toString(36).padStart(3, "0")}`;
    const list = Array.from({ length: tasks }, (_, t) => ({
      threadId: `${id}-thread-${t.toString(36).padStart(3, "0")}`,
      title: `${word(t)} ${word(t + b)} for account ${t * 7 + b}`,
      createdAt: now - (tasks - t) * 3_600_000,
      updatedAt: now - (tasks - t) * 60_000,
      resumeCursors: { claude: { sessionId: `session-${b}-${t}` } },
      unread: t % 9 === 0,
      approvalMode: "ask",
      autoApprove: false,
      alwaysAllow: ["Read", "Grep"],
      askedAt: now - (tasks - t) * 90_000,
      ...(t % 5 === 0 ? { pinned: true } : {}),
    }));
    return {
      id, threadId: list[0]!.threadId, name: `Bench ${b}`, title: "Helper", description: `Bench bot ${b} helps with accounts.`,
      soul: "", notifications: true, color: "#6b5bd6", unread: false, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
      resumeCursors: {}, createdAt: now - 30 * 86_400_000, cloudBackend: "vps", section: b % 3 ? "Team" : "Ops", tasks: list,
    };
  });
}

function newDataDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, "tmp"), { recursive: true });
  writeFileSync(join(dir, "config.json"), JSON.stringify({
    features: { smartSetupChoices: false }, language: "en",
    instances: { claude: { driver: "claudeAgent", displayName: "Bench fixture", config: { cli: join(ROOT, "server", "testing", "fake-claude-cli.ts") } } },
  }, null, 2));
  return dir;
}

async function removeDir(dir: string) {
  const { removeTempDir } = await import("../server/testing/cleanup.ts");
  await removeTempDir(dir);
}

/** Runs in a child whose DUSK_DATA_DIR is a fresh folder, since the server's config reads it once at import. */
async function microChild() {
  const dataDir = process.env.DUSK_DATA_DIR!;
  if (!dataDir.includes("duskbot-registry-bench-")) throw new Error("micro runs only on a bench fixture folder");
  const now = Date.now();
  const bots = registryRecords(Number(values.bots), Number(values.tasks), now);
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify(bots), { mode: 0o600 });
  const { Store } = await import("../server/store.ts");
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  const groupThreads: string[] = [];
  for (let g = 0; g < 20; g++) {
    const group = store.createGroup(`Room ${g}`, [bots[g % bots.length]!.id, bots[(g + 1) % bots.length]!.id], false, "Team");
    groupThreads.push(group.threadId);
    for (let t = 0; t < 9; t++) {
      const task = store.createGroupTask(group.id, `room thread ${t}`, false);
      if (task) groupThreads.push(task.threadId);
    }
  }
  const botIds = bots.map((bot) => bot.id);
  const botThreads = bots.flatMap((bot) => bot.tasks.map((task) => task.threadId));
  let seed = 7;
  const random = () => { seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31; return seed / 2 ** 31; };
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;
  // a mix like the live paths ask: mostly known ids, some rooms' threads, some unknown
  const ids = Array.from({ length: 4096 }, () => random() < 0.9 ? pick(botIds) : `missing-${Math.floor(random() * 1e6)}`);
  const threads = Array.from({ length: 4096 }, () => { const r = random(); return r < 0.6 ? pick(botThreads) : r < 0.9 ? pick(groupThreads) : `missing-${Math.floor(random() * 1e6)}`; });
  const time = (fn: (i: number) => unknown, iterations: number) => {
    const samples: number[] = [];
    let sink = 0;
    for (let rep = 0; rep < 7; rep++) {
      const at = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) if (fn(i)) sink++;
      samples.push(Number(process.hrtime.bigint() - at) / iterations);
    }
    if (sink < 0) log("unreachable");
    return median(samples);
  };
  const botNs = time((i) => store.bot(ids[i & 4095]!), 20_000);
  const botByThreadNs = time((i) => store.botByThread(threads[i & 4095]!), 4_000);
  const groupByThreadNs = time((i) => store.groupByThread(threads[i & 4095]!), 4_000);
  // what a person's thread change costs before the request can answer: the store change and its save
  const saves: number[] = [];
  for (let i = 0; i < 60; i++) {
    const bot = pick(bots);
    const threadId = pick(bot.tasks).threadId;
    const at = process.hrtime.bigint();
    store.patchTask(bot.id, threadId, { title: `renamed ${i}` });
    saves.push(Number(process.hrtime.bigint() - at) / 1e6);
  }
  const { flushDeferredSaves } = await import("../server/save-batch.ts");
  flushDeferredSaves();
  const flushes = (store as unknown as { flushRegistry?: () => void }).flushRegistry;
  flushes?.call(store);
  // the change must be on disk: a fresh store over the same folder reads it back
  const reread = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  const lastBot = reread.bots.length;
  process.stdout.write(`${JSON.stringify({
    part: "micro", bots: bots.length, tasksPerBot: Number(values.tasks), rooms: 20, botsReadBack: lastBot,
    botNs: round(botNs), botByThreadNs: round(botByThreadNs), groupByThreadNs: round(groupByThreadNs),
    lookupNs: round(botNs + botByThreadNs + groupByThreadNs), saveMs: round(median(saves), 3), saveP90Ms: round([...saves].sort((a, b) => a - b)[Math.floor(saves.length * 0.9)]!, 3),
  })}\n`);
}

async function micro() {
  const dataDir = newDataDir("duskbot-registry-bench-");
  try {
    const out = execFileSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url), "--micro-child", "--bots", values.bots!, "--tasks", values.tasks!], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: dataDir, USERPROFILE: dataDir, DUSK_DATA_DIR: dataDir, TMPDIR: join(dataDir, "tmp"), TEMP: join(dataDir, "tmp"), TMP: join(dataDir, "tmp"), DUSK_NO_TEST_BOTS: "1" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    return JSON.parse(out.trim().split("\n").at(-1)!) as Record<string, number>;
  } finally {
    await removeDir(dataDir);
  }
}

/** Cumulative CPU of one process in milliseconds, from ps (macOS, Linux) or /proc (Linux). */
function cpuMs(pid: number): number {
  if (process.platform === "linux" && existsSync(`/proc/${pid}/stat`)) {
    const fields = execFileSync("cat", [`/proc/${pid}/stat`], { encoding: "utf8" }).split(") ")[1]!.split(" ");
    return (Number(fields[11]) + Number(fields[12])) * 10;
  }
  const text = execFileSync("ps", ["-o", "cputime=", "-p", String(pid)], { encoding: "utf8" }).trim();
  const parts = text.split(/[:-]/).map(Number);
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds * 1000;
}

/** The query the desktop's live stream sends, from the renderer's own source when it names one. */
async function liveQuery(): Promise<string> {
  const file = join(ROOT, "shared", "live-protocol.ts");
  if (!existsSync(file)) return "screens=off";
  const protocol = await import(pathToFileURL(file).href) as { liveEventsParams?: () => Record<string, string> };
  return new URLSearchParams({ screens: "off", ...protocol.liveEventsParams?.() }).toString();
}

async function live() {
  const dataDir = newDataDir("duskbot-registry-bench-");
  const work = mkdtempSync(join(tmpdir(), "duskbot-registry-work-"));
  const now = Date.now();
  // ten bots with forty threads each; eight threads (six bots' open threads and two more) stream at once
  writeFileSync(join(dataDir, "bots.json"), JSON.stringify(registryRecords(10, 40, now)), { mode: 0o600 });
  const reply = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: the sync of account ${i * 7} finished, three records were checked and one was updated.`).join("\n\n");
  writeFileSync(join(dataDir, "bench-reply.txt"), reply);
  const { verificationServerArgs, verificationServerEnvironment } = await import("./control-dusk.ts");
  const { freePortBlock } = await import("../server/testing/ports.ts");
  const { waitForExit } = await import("../server/testing/cleanup.ts");
  const port = await freePortBlock([0, 1]);
  const env = verificationServerEnvironment({ LANG: process.env.LANG, TZ: process.env.TZ }, dataDir, port);
  Object.assign(env, { FAKE_CLAUDE_REPLY_FILE: join(dataDir, "bench-reply.txt"), FAKE_CLAUDE_STREAM_CADENCE: "6:4", DUSK_NO_TEST_BOTS: "1" });
  const logFd = openSync(join(work, "server.log"), "a", 0o600);
  const child: ChildProcess = spawn(process.execPath, verificationServerArgs(env), { cwd: ROOT, env, stdio: ["ignore", logFd, logFd] });
  closeSync(logFd);
  const url = `http://127.0.0.1:${port}`;
  const abort = new AbortController();
  try {
    for (const deadline = Date.now() + 90_000; ; await sleep(50)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`fixture server did not start; see ${work}`);
      try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok) break; } catch { /* not yet */ }
    }
    const call = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(`${url}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
      return response.json() as Promise<T>;
    };
    type WireBot = { id: string; threadId: string; tasks?: Array<{ threadId: string }> };
    const bots = (await call<{ bots: WireBot[] }>("/api/bots?messages=0")).bots.filter((bot) => bot.id.startsWith("bench-bot-")).sort((a, b) => a.id.localeCompare(b.id));
    const targets = [...bots.slice(0, 6).map((bot) => ({ botId: bot.id, threadId: bot.threadId })),
      ...bots.slice(0, 2).map((bot) => ({ botId: bot.id, threadId: bot.tasks!.at(-1)!.threadId }))];
    // the stream, read as the desktop reads it
    const response = await fetch(`${url}/api/events?${await liveQuery()}`, { headers: { accept: "text/event-stream" }, signal: abort.signal });
    const reader = response.body!.getReader();
    let counting = false, bytes = 0, frames = 0, text = "";
    const kinds: Record<string, number> = {};
    const kindBytes: Record<string, number> = {};
    const completed = new Set<string>();
    const decoder = new TextDecoder();
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done || !value) return;
        if (counting) bytes += value.byteLength;
        text += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = text.indexOf("\n\n")) >= 0) {
          const block = text.slice(0, end);
          text = text.slice(end + 2);
          const data = block.split("\n").find((line) => line.startsWith("data: "));
          if (!data) continue;
          const frame = JSON.parse(data.slice(6)) as { kind: string; event?: { type?: string; threadId?: string; turnId?: string } };
          if (!counting) continue;
          frames++;
          kinds[frame.kind] = (kinds[frame.kind] ?? 0) + 1;
          kindBytes[frame.kind] = (kindBytes[frame.kind] ?? 0) + block.length + 2;
          if (frame.kind === "runtime" && frame.event?.type === "turn.completed" && frame.event.threadId) completed.add(`${frame.event.threadId}:${frame.event.turnId}`);
        }
      }
    })();
    await sleep(1_500);
    const rounds = Number(values.rounds);
    counting = true;
    const cpuBefore = cpuMs(child.pid!);
    const started = performance.now();
    for (let r = 0; r < rounds; r++) {
      const before = completed.size;
      await Promise.all(targets.map((target, i) => call(`/api/bots/${target.botId}/messages`, { threadId: target.threadId, text: `bench round ${r} thread ${i}` })));
      for (const deadline = Date.now() + 90_000; completed.size < before + targets.length; await sleep(20)) {
        if (Date.now() > deadline) throw new Error(`only ${completed.size - before} of ${targets.length} turns finished; see ${work}`);
      }
      await sleep(600);
    }
    const wallMs = performance.now() - started;
    const cpu = cpuMs(child.pid!) - cpuBefore;
    counting = false;
    return {
      part: "live", threads: targets.length, rounds, liveBytes: bytes, frames, wallMs: Math.round(wallMs), bytesPerSecond: Math.round(bytes / (wallMs / 1000)),
      harnessCpuMs: Math.round(cpu), cpuPercent: round((cpu / wallMs) * 100, 1), kinds, kindBytes,
    };
  } finally {
    abort.abort();
    await waitForExit(child, { signal: "SIGTERM" });
    await removeDir(dataDir);
    await removeDir(work);
  }
}

function score(result: Record<string, number>): number {
  let total = 0;
  for (const key of Object.keys(BARS) as Array<keyof typeof BARS>) {
    const value = result[key];
    if (value === undefined || !BARS[key]) continue;
    total += Math.max(0, Math.log(value / BARS[key]));
    if (BASELINE[key]) total += Math.max(0, Math.log(value / (BASELINE[key] * 1.15)));
  }
  return total;
}

if (values["micro-child"]) {
  await microChild();
} else {
  const result: Record<string, number> = {};
  if (values.part === "micro" || values.part === "all") {
    const m = await micro();
    process.stdout.write(`${JSON.stringify(m)}\n`);
    Object.assign(result, m);
  }
  if (values.part === "live" || values.part === "all") {
    const l = await live();
    process.stdout.write(`${JSON.stringify(l)}\n`);
    Object.assign(result, l);
  }
  if (values.json) writeFileSync(values.json, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`score ${round(score(result), 4)}\n`);
}
