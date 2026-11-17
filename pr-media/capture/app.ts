// Films the real app (this branch's built UI, `pnpm build` first) while eight threads stream, on an isolated fake-engine
// server: a temporary HOME and data folder, never a real app, account or data. The page's own EventSource is tapped to
// count every frame the renderer receives. Writes pr-media/recording/app/*.jpg, pr-media/data/app.json and two 2x stills.
//   node --experimental-strip-types pr-media/capture/app.ts
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { verificationServerArgs, verificationServerEnvironment } from "../../scripts/control-dusk.ts";
import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { freePortBlock } from "../../server/testing/ports.ts";
import { launch } from "./cdp.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FRAMES = join(ROOT, "pr-media", "recording", "app");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const dataDir = mkdtempSync(join(tmpdir(), "duskbot-pr-media-"));
mkdirSync(join(dataDir, "tmp"));
writeFileSync(join(dataDir, "config.json"), JSON.stringify({
  features: { smartSetupChoices: false }, language: "en",
  instances: { claude: { driver: "claudeAgent", displayName: "Fake engine", config: { cli: join(ROOT, "server", "testing", "fake-claude-cli.ts") } } },
}));
const now = Date.now();
const NAMES = ["Nova", "Quill", "Rivet", "Tally", "Echo", "Juno"];
const COLORS = ["blue", "purple", "red", "orange", "teal", "green"];
const TOPICS = ["Weekly report", "Invoice cleanup", "Launch checklist", "Bug triage", "Customer follow-ups", "Data import", "Release notes", "Team sync"];
const bots = NAMES.map((name, b) => {
  const id = `media-${name.toLowerCase()}`;
  const tasks = Array.from({ length: 30 }, (_, t) => ({
    threadId: `${id}-t${String(t).padStart(2, "0")}`, title: `${TOPICS[(t + b) % TOPICS.length]} ${t + 1}`,
    createdAt: now - (30 - t) * 3_600_000, updatedAt: now - (30 - t) * 600_000, resumeCursors: {}, unread: false,
  }));
  return { id, threadId: tasks[0]!.threadId, name, title: "Helper", description: `${name} helps the team.`, soul: "", notifications: true,
    color: COLORS[b], unread: false, modelSelection: { instanceId: "claude", model: "claude-sonnet-5" }, resumeCursors: {},
    createdAt: now - 30 * 86_400_000, cloudBackend: "vps", section: "Team", tasks };
});
writeFileSync(join(dataDir, "bots.json"), JSON.stringify(bots), { mode: 0o600 });
const reply = [
  "Went through today's records. Here's what moved since yesterday:",
  ...Array.from({ length: 8 }, (_, i) => `- Account ${i * 7 + 3}: ${["two invoices paid", "one refund pending", "address updated", "renewal confirmed", "plan upgraded", "card expiring soon", "new contact added", "nothing changed"][i]}.`),
  "Nothing needs you right now. I'll flag the refund if it isn't through by Friday.",
].join("\n");
writeFileSync(join(dataDir, "reply.txt"), reply);

const port = await freePortBlock([0, 1]);
const env = verificationServerEnvironment({ LANG: process.env.LANG, TZ: process.env.TZ, DUSK_VERIFY_HOME_OUTSIDE: "1" }, dataDir, port);
Object.assign(env, { DUSK_STATIC_DIR: join(ROOT, "dist"), FAKE_CLAUDE_REPLY_FILE: join(dataDir, "reply.txt"), FAKE_CLAUDE_STREAM_CADENCE: "2:30", DUSK_NO_TEST_BOTS: "1" });
const logFd = openSync(join(dataDir, "server.log"), "a", 0o600);
const child = spawn(process.execPath, verificationServerArgs(env), { cwd: ROOT, env, stdio: ["ignore", logFd, logFd] });
closeSync(logFd);
const url = `http://127.0.0.1:${port}`;

const STORAGE = { "dusk-analytics-opt-out": "1", "dusk-email-gate": "skipped", "dusk-simple-mode-prompt": "1", "grok-move-2026-11": "1", "dusk-advanced-mode": "1" };
const INIT = `(() => {
  try { for (const [k, v] of Object.entries(${JSON.stringify(STORAGE)})) localStorage.setItem(k, v); } catch {}
  const Native = window.EventSource;
  window.__tap = []; window.__tapUrls = [];
  window.EventSource = function (u, o) {
    const s = new Native(u, o); window.__tapUrls.push(String(u));
    s.addEventListener("message", (e) => { try { const f = JSON.parse(e.data); window.__tap.push([performance.now(), f.kind, e.data.length, f.kind === "runtime" ? f.event?.type : undefined,
      f.kind === "task.patch" ? [f.botId, f.threadId, Object.keys(f.fields || {})] : f.kind === "bot.patch" ? [f.id, (f.tasks?.change || []).map((c) => c.threadId)[0], Object.keys(f.fields || {}).concat((f.tasks?.change || []).flatMap((c) => Object.keys(c.fields || {})))] : f.kind === "bot" ? [f.bot?.id] : undefined]); } catch {} });
    return s;
  };
  window.EventSource.prototype = Native.prototype;
})();`;

const chrome = await launch();
try {
  for (const deadline = Date.now() + 90_000; ; await sleep(100)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`fixture did not start; see ${dataDir}/server.log`);
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* not yet */ }
  }
  const tab = await chrome.tab(1440, 900, 2, INIT);
  await tab.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: process.env.PR_MEDIA_SCHEME ?? "light" }] });
  await tab.goto(url);
  for (const deadline = Date.now() + 30_000; !(await tab.evaluate<boolean>(`[...document.querySelectorAll("[data-sidebar-bot-row]")].some((b) => b.textContent.includes("Nova"))`)); await sleep(100)) {
    if (Date.now() > deadline) { await tab.shot(join(ROOT, "pr-media", "data", "app-load-failed.png")); throw new Error("app did not load"); }
  }
  await tab.evaluate(`[...document.querySelectorAll("[data-sidebar-bot-row]")].find((b) => b.textContent.includes("Nova")).click()`);
  await sleep(1500);
  await tab.shot(join(ROOT, "pr-media", "data", "app-idle@2x.png"));
  // warm: a window that has been open a while already holds every bot, so each bot's first frame after the boot read
  // (which goes out whole) is spent before filming
  for (const bot of bots) await fetch(`${url}/api/bots/${bot.id}/tasks/${bot.tasks[1]!.threadId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `${bot.tasks[1]!.title}` + " ✓" }),
  });
  await sleep(1500);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const targets = [...bots.map((bot) => ({ bot: bot.id, thread: bot.threadId })), ...bots.slice(0, 2).map((bot) => ({ bot: bot.id, thread: bot.tasks[5]!.threadId }))];
  const pageStart = await tab.evaluate<number>("performance.now()");
  const shots: Array<{ t: number; file: string }> = [];
  const started = performance.now();
  let sent = false, settledAt = 0, still = false;
  for (let i = 0; ; i++) {
    const t = (performance.now() - started) / 1000;
    const file = `f${String(i).padStart(4, "0")}.jpg`;
    await tab.shot(join(FRAMES, file), { format: "jpeg", quality: 88 });
    shots.push({ t, file });
    if (!sent && t > 0.8) {
      sent = true;
      await Promise.all(targets.map((target, n) => fetch(`${url}/api/bots/${target.bot}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: target.thread, text: n === 0 ? "Go through today's records and tell me what changed." : `Check round ${n + 1}, please.` }),
      })));
    }
    if (sent && !still && t > 3.2) {
      still = true;
      await tab.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
      await tab.shot(join(ROOT, "pr-media", "data", "app-streaming@2x.png"));
      await tab.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    }
    const completed = await tab.evaluate<number>(`window.__tap.filter((f) => f[3] === "turn.completed").length`);
    if (sent && completed >= targets.length && !settledAt) settledAt = t;
    if (settledAt && t > settledAt + 1.6) break;
    if (t > 60) throw new Error("turns did not settle");
  }
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(300);
  await tab.shot(join(ROOT, "pr-media", "data", "app-after@2x.png"));
  const tap = await tab.evaluate<Array<[number, string, number, string?, unknown?]>>("window.__tap");
  const urls = await tab.evaluate<string[]>("window.__tapUrls");
  const reads = await tab.evaluate<string[]>(`performance.getEntriesByType("resource").map((e) => e.name.replace(location.origin, "")).filter((n) => n.startsWith("/api/bots?"))`);
  writeFileSync(join(ROOT, "pr-media", "data", "app.json"), JSON.stringify({
    viewport: [1440, 900], scale: 2, shots, settledAt, streamUrls: urls, snapshotReads: reads,
    tap: tap.map(([at, kind, bytes, type, who]) => ({ t: (at - pageStart) / 1000, kind, bytes, ...(type ? { type } : {}), ...(who ? { who } : {}) })),
  }));
  console.log(JSON.stringify({ frames: shots.length, seconds: shots.at(-1)?.t, fps: shots.length / (shots.at(-1)?.t ?? 1), settledAt, streamUrls: urls, snapshotReads: reads, tapped: tap.length }));
} finally {
  await chrome.close();
  await waitForExit(child, { signal: "SIGTERM" });
  await removeTempDir(dataDir);
  await removeTempDir(`${dataDir}-home`);
}
