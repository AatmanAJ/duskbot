// Records what both live-stream protocols carry while eight threads stream at once, on an isolated fake-engine server
// (temporary HOME and data folder, never a real app or account). Writes pr-media/data/streams.json: every frame each
// stream received, with its time, kind, size and (for bot traffic) the frame itself.
//   node --experimental-strip-types pr-media/capture/streams.ts
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verificationServerArgs, verificationServerEnvironment } from "../../scripts/control-dusk.ts";
import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { freePortBlock } from "../../server/testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dataDir = mkdtempSync(join(tmpdir(), "duskbot-pr-media-"));
mkdirSync(join(dataDir, "tmp"));
writeFileSync(join(dataDir, "config.json"), JSON.stringify({
  features: { smartSetupChoices: false }, language: "en",
  instances: { claude: { driver: "claudeAgent", displayName: "Fake engine", config: { cli: join(ROOT, "server", "testing", "fake-claude-cli.ts") } } },
}));
const now = Date.now();
const NAMES = ["Nova", "Quill", "Rivet", "Tally", "Echo", "Juno", "Basil", "Moss", "Pip", "Kit"];
const COLORS = ["blue", "purple", "red", "orange", "teal", "green", "yellow", "pink", "cyan", "coral"];
const TOPICS = ["Weekly report", "Invoice cleanup", "Launch checklist", "Bug triage", "Customer follow-ups", "Data import", "Release notes", "Team sync"];
const bots = NAMES.map((name, b) => {
  const id = `media-${name.toLowerCase()}`;
  const tasks = Array.from({ length: 40 }, (_, t) => ({
    threadId: `${id}-t${String(t).padStart(2, "0")}`, title: `${TOPICS[(t + b) % TOPICS.length]} ${t + 1}`,
    createdAt: now - (40 - t) * 3_600_000, updatedAt: now - (40 - t) * 600_000, resumeCursors: {}, unread: false,
  }));
  return { id, threadId: tasks[0]!.threadId, name, title: "Helper", description: `${name} helps the team.`, soul: "", notifications: true,
    color: COLORS[b], unread: false, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, resumeCursors: {},
    createdAt: now - 30 * 86_400_000, cloudBackend: "vps", section: "Team", tasks };
});
writeFileSync(join(dataDir, "bots.json"), JSON.stringify(bots), { mode: 0o600 });
const reply = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}: checked this part of the records, found what changed since yesterday and wrote it down.`).join("\n\n");
writeFileSync(join(dataDir, "reply.txt"), reply);

const port = await freePortBlock([0, 1]);
const env = verificationServerEnvironment({ LANG: process.env.LANG, TZ: process.env.TZ, DUSK_VERIFY_HOME_OUTSIDE: "1" }, dataDir, port);
Object.assign(env, { FAKE_CLAUDE_REPLY_FILE: join(dataDir, "reply.txt"), FAKE_CLAUDE_STREAM_CADENCE: "4:22", DUSK_NO_TEST_BOTS: "1" });
const logFd = openSync(join(dataDir, "server.log"), "a", 0o600);
const child = spawn(process.execPath, verificationServerArgs(env), { cwd: ROOT, env, stdio: ["ignore", logFd, logFd] });
closeSync(logFd);
const url = `http://127.0.0.1:${port}`;
const abort = new AbortController();

type Frame = { t: number; kind: string; bytes: number; frame?: unknown; event?: { type?: string; threadId?: string } };
async function record(query: string, into: Frame[], start: { at: number }) {
  const response = await fetch(`${url}/api/events?${query}`, { headers: { accept: "text/event-stream" }, signal: abort.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
    if (done || !value) return;
    text += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = text.indexOf("\n\n")) >= 0) {
      const block = text.slice(0, end);
      text = text.slice(end + 2);
      const data = block.split("\n").find((line) => line.startsWith("data: "));
      if (!data || !start.at) continue;
      const frame = JSON.parse(data.slice(6)) as { kind: string; event?: { type?: string; threadId?: string } };
      const bot = frame.kind === "bot" || frame.kind === "bot.patch" || frame.kind === "task.patch";
      const event = frame.kind === "runtime" ? { type: frame.event?.type, threadId: frame.event?.threadId } : undefined;
      into.push({ t: (performance.now() - start.at) / 1000, kind: frame.kind, bytes: Buffer.byteLength(block) + 2, ...(bot ? { frame } : {}), ...(event ? { event } : {}) });
    }
  }
}

try {
  for (const deadline = Date.now() + 90_000; ; await sleep(100)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`fixture did not start; see ${dataDir}/server.log`);
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* not yet */ }
  }
  const start = { at: 0 };
  const v1: Frame[] = [], v2: Frame[] = [];
  void record("screens=off", v1, start);
  void record("screens=off&protocol=2", v2, start);
  // warm: a running app has had a frame of every bot already, so each bot's first (whole) frame goes out before measuring
  for (const bot of bots) await fetch(`${url}/api/bots/${bot.id}/tasks/${bot.tasks[1]!.threadId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `${bot.tasks[1]!.title} (warm)` }),
  });
  await sleep(1500);
  const targets = [...bots.slice(0, 6).map((bot) => ({ bot: bot.id, thread: bot.threadId })), ...bots.slice(0, 2).map((bot) => ({ bot: bot.id, thread: bot.tasks[5]!.threadId }))];
  start.at = performance.now();
  await Promise.all(targets.map((target, i) => fetch(`${url}/api/bots/${target.bot}/messages`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: target.thread, text: `round of checks ${i + 1}` }),
  })));
  // settled when every thread's turn completed on the stream: reading the bots here would reset protocol 2's patching
  for (const deadline = Date.now() + 120_000; ; await sleep(100)) {
    const done = new Set(v1.filter((frame) => frame.event?.type === "turn.completed").map((frame) => frame.event!.threadId));
    if (targets.every((target) => done.has(target.thread))) break;
    if (Date.now() > deadline) throw new Error("turns did not settle");
  }
  await sleep(1200);
  const out = join(ROOT, "pr-media", "data", "streams.json");
  writeFileSync(out, JSON.stringify({ capturedAt: new Date().toISOString(), threads: targets.length, bots: bots.length, threadsPerBot: 40, targets, protocol1: v1, protocol2: v2 }));
  const sum = (frames: Frame[]) => frames.reduce((total, frame) => total + frame.bytes, 0);
  console.log(JSON.stringify({ out, protocol1: { frames: v1.length, bytes: sum(v1) }, protocol2: { frames: v2.length, bytes: sum(v2) } }));
} finally {
  abort.abort();
  await waitForExit(child, { signal: "SIGTERM" });
  await removeTempDir(dataDir);
  await removeTempDir(`${dataDir}-home`);
}
