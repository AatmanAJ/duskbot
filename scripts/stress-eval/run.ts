// Stress eval: many realistic conversations (scenarios.ts) against real dusk bot servers started from --repo, each
// with its own data dir under --tmp and a port pair in 8900-8999, bots on one OpenAI-compatible engine pointed at the
// gateway. Conversations run several at a time per server and on several servers at once, through the app's HTTP
// routes and its live event stream. Each is scored by hard checks (files and links open, no tool or step text in chat,
// no errors, no stuck turns, latency) and a judge model, and appended to <out>/results.jsonl as it finishes; a rerun
// with the same --out skips what is already there.
//   node --experimental-strip-types scripts/stress-eval/run.ts --tmp <dir> --out <dir> --fixtures <dir> \
//     [--model gpt-6.2-sol] [--judge gpt-6.2-sol] [--repeat 2] [--servers 4] [--parallel 3] [--recycle 9] [--only id,id]
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { client } from "../memory-eval/client.ts";
import { gatewayFromEnv, type Gateway } from "../memory-eval/sandbox.ts";
import { launchServer, type StressServer } from "./server.ts";
import { listen, type Frame } from "./events.ts";
import { SCENARIOS, type Scenario } from "./scenarios.ts";
import { hardChecks, type Checked } from "./checks.ts";
import { judge, type Verdict } from "./judge.ts";

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: {
  repo: { type: "string", default: resolve(here, "..", "..") },
  tmp: { type: "string" },
  out: { type: "string" },
  fixtures: { type: "string" },
  model: { type: "string", default: "gpt-6.2-sol" },
  judge: { type: "string", default: "gpt-6.2-sol" },
  repeat: { type: "string", default: "2" },
  servers: { type: "string", default: "4" },
  parallel: { type: "string", default: "3" },
  recycle: { type: "string", default: "9" },
  only: { type: "string", default: "" },
  limit: { type: "string", default: "0" },
  /** keep each server's data folder (jobs, job logs, native logs) beside its server.log */
  keep: { type: "boolean", default: false },
  /** how long the live check waits for a watch to report the changed page */
  "live-wait": { type: "string", default: "240000" },
} });
if (!values.tmp || !values.out || !values.fixtures) throw new Error("--tmp, --out and --fixtures are required");
const out = values.out;
mkdirSync(out, { recursive: true });
const resultsPath = join(out, "results.jsonl");
const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gateway: Gateway = gatewayFromEnv(values.model!);

const done = new Set(existsSync(resultsPath) ? readFileSync(resultsPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line).key as string) : []);
const only = values.only ? new Set(values.only.split(",")) : null;
let jobs: Array<{ key: string; run: number; scenario: Scenario }> = [];
for (let run = 1; run <= Number(values.repeat); run++) {
  for (const scenario of SCENARIOS) if (!only || only.has(scenario.id)) jobs.push({ key: `${scenario.id}#${run}`, run, scenario });
}
jobs = jobs.filter((job) => !done.has(job.key));
if (Number(values.limit) > 0) jobs = jobs.slice(0, Number(values.limit));
log(`${jobs.length} conversations to run (${done.size} already done)`);

// The page the live monitor check watches: one path per conversation, whose status the eval flips after it.
const pages = new Map<string, { status: string; hits: number }>();
const pageServer = createServer((req, res) => {
  const page = pages.get((req.url ?? "").split("?")[0]!);
  if (!page) { res.writeHead(404); res.end(); return; }
  page.hits += 1;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><html><head><title>Order 4471</title></head><body><h1>Order 4471</h1><p id="status">Status: ${page.status}</p></body></html>`);
});
await new Promise<void>((done) => pageServer.listen(0, "127.0.0.1", done));
const pageBase = `http://127.0.0.1:${(pageServer.address() as { port: number }).port}`;

type JobFact = { id: string; label: string; command: string; state: string; starts: number; crashes: number; lastExit?: string; alive: boolean; log: string };

/** The bot's background jobs as the server keeps them, whether each process is alive, and the end of its log. */
function jobsOf(dataDir: string, botId: string): JobFact[] {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, "jobs.json"), "utf8")) as { jobs?: Array<Record<string, unknown>> };
    return (raw.jobs ?? []).filter((job) => job.botId === botId).map((job) => {
      let alive = false;
      try { if (typeof job.pid === "number") { process.kill(job.pid, 0); alive = true; } } catch { alive = false; }
      let tail = "";
      try { tail = readFileSync(join(dataDir, "job-logs", `${String(job.id)}.log`), "utf8").slice(-600); } catch { /* no log yet */ }
      return { id: String(job.id), label: String(job.label), command: String(job.command).slice(0, 300), state: String(job.state), starts: Number(job.starts), crashes: Number(job.crashes),
        ...(job.lastExit ? { lastExit: String(job.lastExit) } : {}), alive, log: tail };
    });
  } catch { return []; }
}

const atMs = (value: unknown) => typeof value === "number" ? value : Date.parse(String(value ?? ""));

export interface TurnTiming { say: string; sentAt: number; firstVisibleMs: number | null; firstTextMs: number | null }
type Message = {
  id: string; role: string; at?: number | string; kind?: string; text?: string; card?: unknown;
  attachments?: Array<{ kind: string; path: string; name?: string; mime?: string }>;
  document?: { botId: string; id: string; title: string; kind: string; bytes: number };
  /** the harness's own read of the document card's file: its status and opening text */
  documentRead?: { status: number; text: string };
};
export interface ThreadLog { threadId: string; messages: Message[] }

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf", csv: "text/csv" };

async function upload(base: string, name: string): Promise<string> {
  const ext = name.split(".").at(-1)!.toLowerCase();
  const mime = MIME[ext]!;
  const bytes = readFileSync(join(values.fixtures!, name));
  const image = mime.startsWith("image/");
  const path = image ? `/api/attachments?uploadId=${randomUUID()}` : `/api/files?name=${encodeURIComponent(name)}&uploadId=${randomUUID()}`;
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": mime, origin: base }, body: bytes });
  const saved = await res.json() as { path?: string; error?: string };
  if (!res.ok || !saved.path) throw new Error(`upload ${name} -> ${res.status}: ${saved.error ?? "?"}`);
  const attr = (v: string) => v.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return image ? `<attached-image path="${attr(saved.path)}" name="${attr(name)}" />` : `<attached-file path="${attr(saved.path)}" name="${attr(name)}" />`;
}

const TERMINAL = ["needs-input", "completed", "failed", "stalled", "idle"];

async function waitIdle(api: ReturnType<typeof client>, threadId: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  await sleep(800);
  let quiet = 0;
  for (;;) {
    const job = await api.call("GET", `/api/threads/${threadId}/job?scope=turn`).catch(() => ({ state: "unreachable" }));
    if (TERMINAL.includes(job.state)) {
      // a queued follow-up can start right after a turn ends: settle only on two quiet reads in a row
      if (++quiet >= 2) return job.state;
    } else quiet = 0;
    if (Date.now() > deadline) return `timeout(${job.state})`;
    await sleep(700);
  }
}

async function converse(srv: StressServer, frames: Frame[], job: { key: string; run: number; scenario: Scenario }) {
  const api = client(srv.url);
  const { scenario } = job;
  const started = Date.now();
  const bot = await api.createBot("Sage", values.model!);
  if (scenario.browser) await api.call("PATCH", `/api/bots/${bot.id}`, { computer: "browser", browser: true });
  let threadId = await api.newThread(bot.id);
  const threads = [threadId];
  const timings: Array<TurnTiming & { threadId: string; state?: string; totalMs?: number }> = [];
  const states: string[] = [];
  const turnTimeout = scenario.long ? 600_000 : 300_000;
  const pagePath = `/order/${randomUUID().slice(0, 8)}`;
  if (scenario.localPage) pages.set(pagePath, { status: "PROCESSING", hits: 0 });
  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i]!;
    if (turn.newThread) {
      await sleep(4_000);
      threadId = await api.newThread(bot.id);
      threads.push(threadId);
    }
    const parts = [turn.say.replaceAll("{{PAGE}}", `${pageBase}${pagePath}`)];
    for (const name of turn.attach ?? []) parts.push(await upload(srv.url, name));
    const sentAt = Date.now();
    await api.call("POST", `/api/bots/${bot.id}/messages`, { text: parts.join("\n\n"), threadId, sendId: randomUUID() });
    timings.push({ say: turn.say, sentAt, firstVisibleMs: null, firstTextMs: null, threadId });
    const next = scenario.turns[i + 1];
    if (next?.afterMs !== undefined && !next.newThread) {
      await sleep(next.afterMs);
      continue;
    }
    const state = await waitIdle(api, threadId, turnTimeout);
    states.push(state);
    const end = Date.now();
    for (const timing of timings.filter((t) => t.totalMs === undefined)) { timing.totalMs = end - timing.sentAt; timing.state = state; }
    if (state.startsWith("timeout")) break;
  }
  await sleep(1_500);
  // first words on screen: a streamed delta or a posted bot text, after the message was sent and before the next one
  for (let i = 0; i < timings.length; i++) {
    const t = timings[i]!;
    const until = timings[i + 1]?.sentAt ?? Infinity;
    const mine = frames.filter((f) => f.threadId === t.threadId && f.at >= t.sentAt && f.at < until);
    const text = mine.find((f) => f.kind === "message" && f.data.message?.role === "bot" && f.data.message?.kind === "text" && (f.data.message.text ?? "").trim());
    const delta = mine.find((f) => f.kind === "runtime" && f.data.event?.type === "content.delta" && f.data.event?.streamKind === "assistant_text");
    t.firstTextMs = text ? text.at - t.sentAt : null;
    const visible = [text?.at, delta?.at].filter((v): v is number => typeof v === "number");
    t.firstVisibleMs = visible.length ? Math.min(...visible) - t.sentAt : null;
  }
  // the live check: change the watched page and wait for the bot to say so by itself in its chats
  let liveCheck: Record<string, unknown> | undefined;
  if (scenario.localPage) {
    const page = pages.get(pagePath)!;
    const jobsBefore = jobsOf(srv.dataDir, bot.id);
    const hitsBefore = page.hits;
    await sleep(5_000);
    const flipAt = Date.now();
    page.status = "SHIPPED";
    let notified: { text: string; afterMs: number } | null = null;
    const deadline = flipAt + Number(values["live-wait"]);
    while (!notified && Date.now() < deadline) {
      await sleep(5_000);
      for (const id of threads) {
        const said = ((await api.call("GET", `/api/threads/${id}/messages?limit=50`).catch(() => ({ messages: [] }))).messages as Message[])
          .find((m) => m.role === "bot" && m.kind === "text" && atMs(m.at) > flipAt && (m.text ?? "").trim());
        if (said) notified = { text: (said.text ?? "").slice(0, 400), afterMs: atMs(said.at) - flipAt };
      }
    }
    if (notified) await waitIdle(api, threadId, 120_000);
    liveCheck = { pageHitsBeforeChange: hitsBefore, pageHitsAfterChange: page.hits - hitsBefore, jobsBefore: jobsBefore.map(({ log: _log, ...job }) => job),
      jobsAfter: jobsOf(srv.dataDir, bot.id), notified: notified !== null, ...(notified ? { notifiedAfterMs: notified.afterMs, notice: notified.text } : { waitedMs: Number(values["live-wait"]) }) };
    pages.delete(pagePath);
  }
  const threadLogs: ThreadLog[] = [];
  for (const id of threads) threadLogs.push({ threadId: id, messages: (await api.call("GET", `/api/threads/${id}/messages?limit=300`)).messages });
  for (const message of threadLogs.flatMap((t) => t.messages)) {
    if (!message.document) continue;
    const res = await fetch(`${srv.url}/api/bots/${message.document.botId}/documents/${message.document.id}`, { headers: { origin: srv.url } }).catch(() => null);
    const doc = await res?.json().catch(() => null) as { content?: string } | null;
    message.documentRead = { status: res?.status ?? 0, text: String(doc?.content ?? "").slice(0, 4_000) };
  }
  const runtime = frames.filter((f) => threads.includes(f.threadId ?? "") && f.kind === "runtime").map((f) => f.data.event);
  const tools = runtime.filter((e) => e?.type === "item.started" && e.itemType === "tool").map((e) => {
    const inner = /"name"\s*:\s*"([\w.-]+)"/.exec(String(e.input ?? ""))?.[1];
    return `${String(e.title ?? "?")}${String(e.title).endsWith("use_tool") && inner ? `:${inner}` : ""}`;
  });
  const runtimeErrors = runtime.filter((e) => e?.type === "runtime.error" || e?.type === "runtime.notice" || e?.type === "turn.retrying").map((e) => `${e.type}: ${String(e.message ?? e.reason ?? "").slice(0, 300)}`);
  const routines = (await api.call("GET", "/api/routines").catch(() => ({ routines: [] }))).routines
    .filter((r: { botId: string }) => r.botId === bot.id)
    .map((r: { name: string; prompt: string; enabled: boolean; schedule: unknown }) => ({ name: r.name, enabled: r.enabled, schedule: r.schedule, prompt: r.prompt.slice(0, 200) }));
  const waitsFile = join(srv.dataDir, "waits.json");
  let waits: unknown[] = [];
  try {
    const raw = JSON.parse(readFileSync(waitsFile, "utf8"));
    const list = Array.isArray(raw) ? raw : Object.values(raw?.waits ?? raw ?? {});
    waits = (list as Array<Record<string, unknown>>).filter((w) => JSON.stringify(w).includes(bot.id)).map((w) => ({ label: w.label, kind: w.kind, state: w.state ?? w.status }));
  } catch { /* no waits */ }
  const jobFacts = jobsOf(srv.dataDir, bot.id);
  const memory = await api.call("GET", `/api/bots/${bot.id}/memory`).then((m) => String(m.text ?? "")).catch(() => "");
  const aboutMe = await api.aboutMe().catch(() => "");
  const checked: Checked = await hardChecks(srv.url, threadLogs, timings, states, runtimeErrors);
  const verdict: Verdict = await judge(gatewayFromEnv(values.judge!), scenario, threadLogs, { tools, routines, waits, jobs: jobFacts, ...(liveCheck ? { liveCheck } : {}), memory: memory.slice(-1500), aboutMe: aboutMe.slice(-800), checked });
  return {
    key: job.key, id: scenario.id, run: job.run, persona: scenario.persona, shape: scenario.shape, model: values.model, at: new Date().toISOString(),
    wallMs: Date.now() - started, states, timings: timings.map(({ say, firstVisibleMs, firstTextMs, totalMs, state }) => ({ say: say.slice(0, 120), firstVisibleMs, firstTextMs, totalMs, state })),
    tools, runtimeErrors, routines, waits, jobs: jobFacts, ...(liveCheck ? { liveCheck } : {}), checked, verdict, dataDir: srv.dataDir, memory: memory.slice(-1500), aboutMe: aboutMe.slice(-800),
    transcript: threadLogs.map((t) => t.messages.filter((m) => m.kind === "text" || (m.role === "bot" && m.kind !== "activity" && m.kind !== "digest")).map((m) => ({
      role: m.role, kind: m.kind, text: (m.text ?? "").slice(0, 4_000), ...(m.document ? { document: { title: m.document.title, kind: m.document.kind, bytes: m.document.bytes, status: m.documentRead?.status } } : {}), attachments: (m.attachments ?? []).map((a) => ({ kind: a.kind, name: a.name ?? a.path.split("/").at(-1) })),
    }))),
  };
}

function serverErrors(srv: StressServer, label: string): void {
  try {
    const lines = readFileSync(srv.logPath, "utf8").split("\n").filter((line) => /\b(error|uncaught|unhandled|exception|ECONNRESET|EADDRINUSE|failed)\b/i.test(line));
    for (const line of lines) appendFileSync(join(out, "server-errors.jsonl"), `${JSON.stringify({ server: label, line: line.slice(0, 600) })}\n`);
  } catch { /* no log */ }
}

async function worker(index: number): Promise<void> {
  const perServer = Number(values.recycle);
  const parallel = Number(values.parallel);
  while (jobs.length) {
    const batch = jobs.splice(0, perServer);
    const label = `w${index}-${Date.now()}`;
    let srv: StressServer;
    try {
      srv = await launchServer(values.repo!, values.tmp!, gateway, [values.model!]);
    } catch (error) {
      log("server failed to start", (error as Error).message);
      jobs.unshift(...batch);
      await sleep(10_000);
      continue;
    }
    const frames: Frame[] = [];
    const stream = listen(srv.url, (frame) => { if (frame.kind === "message" || frame.kind === "runtime") frames.push(frame); });
    log(label, "up at", srv.url, "with", batch.length, "conversations");
    const lane = async () => {
      for (;;) {
        const job = batch.shift();
        if (!job) return;
        try {
          const result = await converse(srv, frames, job);
          appendFileSync(resultsPath, `${JSON.stringify({ ...result, server: label })}\n`);
          const v = result.verdict;
          log(job.key, v.pass ? "PASS" : "FAIL", `${Math.round(result.wallMs / 1000)}s`, v.flags.join(","), "-", v.why);
        } catch (error) {
          appendFileSync(resultsPath, `${JSON.stringify({ key: job.key, id: job.scenario.id, run: job.run, persona: job.scenario.persona, shape: job.scenario.shape, server: label, crashed: (error as Error).message.slice(0, 500), verdict: { pass: false, flags: ["harness-crash"], why: (error as Error).message.slice(0, 200) } })}\n`);
          log(job.key, "CRASH", (error as Error).message);
        }
      }
    };
    await Promise.all(Array.from({ length: parallel }, lane));
    stream.close();
    serverErrors(srv, label);
    await srv.close(values.keep);
  }
}

await Promise.all(Array.from({ length: Number(values.servers) }, (_, i) => worker(i)));
log("all done; results in", resultsPath, readdirSync(out).join(", "));
pageServer.close();
