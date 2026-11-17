// Transcript performance harness: the real renderer (Vite dev build, so React's
// Profiler reports) against disposable fake-engine fixtures in headless Chrome.
//
//   node --experimental-strip-types scripts/testing/transcript-perf.ts --label after --out perf.json
//
// stream: a thread with history receives a streamed reply with tool calls;
//         the page counts commits, render time and component renders.
// long:   a thread of 2,000+ messages is loaded in full, then scrolled end to
//         end; the page reports frame times, DOM size and JS heap.
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { launchVerificationServer, runControlDusk, type VerificationServer } from "../control-dusk.ts";
import { closeBrowserSession } from "../../server/browser-engine.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv } from "./control-dusk-ui.ts";
import { fixtureApi, mountPreview } from "./preview-fixture.ts";

const { values } = parseArgs({
  options: {
    scenario: { type: "string", default: "all" },
    messages: { type: "string", default: "2000" },
    label: { type: "string", default: "run" },
    out: { type: "string" },
    runs: { type: "string", default: "3" },
    hold: { type: "boolean", default: false },
  },
});

const note = (line: string) => process.stderr.write(`transcript-perf: ${line}\n`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Browser = (args: string[], timeoutMs?: number) => Promise<Record<string, unknown>>;
interface Context {
  api: ReturnType<typeof fixtureApi>;
  botId: string;
  browser: Browser;
  evaluate<T>(js: string, timeoutMs?: number): Promise<T>;
  fixture: VerificationServer;
  previewUrl: string;
}

async function withFixture<T>(fakeEnv: NodeJS.ProcessEnv, run: (context: Context) => Promise<T>): Promise<T> {
  const { binary, chrome } = await ensureUiBrowser(process.env, note);
  const fixture = await launchVerificationServer({ ...process.env, ...fakeEnv }, undefined, undefined,
    { binaryPath: binary, executablePath: chrome ?? "" });
  const api = fixtureApi(fixture.info.url);
  let closeBrowser = async () => {};
  let closePreview = async () => {};
  try {
    await api("PATCH", "/api/config", { language: "en" });
    const { bots } = await api("GET", "/api/bots") as { bots: Array<{ id: string; defaultBot?: object }> };
    for (const bot of bots.filter((candidate) => candidate.defaultBot)) await api("PATCH", `/api/bots/${bot.id}`, { welcomed: true });
    const created = await runControlDusk(["new-bot", "--name", "Pepper", "--url", fixture.info.url]) as { bot: { id: string } };
    const preview = await mountPreview(fixture, {
      entry: "/scripts/testing/perf-preview.tsx", route: "/__perf.html", title: "dusk bot transcript performance", logLevel: "warn", hmr: false,
    });
    closePreview = () => preview.close();
    const env = sessionEnv({ home: fixture.info.dataDir, session: `dusk-perf-${new URL(fixture.info.url).port}`, chrome });
    env.AGENT_BROWSER_ARGS = [env.AGENT_BROWSER_ARGS, "--js-flags=--expose-gc", "--enable-precise-memory-info", "--window-size=1440,960"].filter(Boolean).join("\n");
    const browser: Browser = (args, timeoutMs) => agentBrowser(binary, env, args, timeoutMs);
    closeBrowser = async () => { if (!await closeBrowserSession(binary, env)) await browser(["close"], 15_000).catch(() => {}); };
    const evaluate = async <R,>(js: string, timeoutMs = 60_000): Promise<R> => {
      const data = await browser(["eval", js], timeoutMs);
      return data.result as R;
    };
    return await run({ api, botId: created.bot.id, browser, evaluate, fixture, previewUrl: `${preview.previewUrl}?open=${encodeURIComponent(created.bot.id)}` });
  } finally {
    await closeBrowser();
    await closePreview();
    await fixture.close();
  }
}

async function busy(api: Context["api"], botId: string): Promise<boolean> {
  const { bots } = await api("GET", "/api/bots?messages=0") as { bots: Array<{ id: string; busy?: boolean; activity?: string }> };
  const bot = bots.find((candidate) => candidate.id === botId);
  return Boolean(bot?.busy || bot?.activity === "working");
}

async function settle(api: Context["api"], botId: string, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  const started = Date.now() + 10_000;
  while (Date.now() < started && !await busy(api, botId)) await sleep(100);
  while (Date.now() < until) {
    if (!await busy(api, botId)) return;
    await sleep(250);
  }
  throw new Error("the bot did not settle");
}

async function send(context: Context, text: string, botId = context.botId) {
  await context.api("POST", `/api/bots/${botId}/messages`, { text, sendId: randomUUID() });
  await settle(context.api, botId);
}

async function threadCount(context: Context): Promise<number> {
  const { bots } = await context.api("GET", "/api/bots?messages=0") as { bots: Array<{ id: string; threadId: string }> };
  const threadId = bots.find((bot) => bot.id === context.botId)?.threadId;
  let total = 0;
  let before: string | undefined;
  for (;;) {
    const page = await context.api("GET", `/api/threads/${threadId}/messages?limit=500${before ? `&before=${encodeURIComponent(before)}` : ""}`) as { messages?: Array<{ id: string }>; hasMore?: boolean };
    const messages = page.messages ?? [];
    total += messages.length;
    if (!page.hasMore || !messages.length) return total;
    before = messages[0]!.id;
  }
}

async function holdOpen(context: Context) {
  if (!values.hold) return;
  process.stderr.write(`${JSON.stringify({ previewUrl: context.previewUrl, url: context.fixture.info.url, botId: context.botId })}\n`);
  await new Promise<void>((resolve) => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
}

async function openTranscript(context: Context) {
  await context.browser(["open", context.previewUrl], 120_000);
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    const ready = await context.evaluate<boolean>(`Boolean(document.querySelector('[role="log"][aria-label*="Pepper"] [data-mid]'))`);
    if (ready) return;
    await sleep(500);
  }
  throw new Error("Pepper's transcript never rendered");
}

const PAGE_HELPERS = `
window.__perfScroller = () => document.querySelector('[role="log"][aria-label*="Pepper"]')?.closest('.overflow-y-auto');
window.__perfFrames = (frames) => {
  const sorted = [...frames].sort((a, b) => a - b);
  const total = frames.reduce((sum, value) => sum + value, 0);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
  const r = (v) => Math.round(v * 100) / 100;
  return { frames: frames.length, avgFps: r(frames.length / (total / 1000)), avgFrameMs: r(total / frames.length), p95FrameMs: r(at(0.95)), maxFrameMs: r(sorted.at(-1) ?? 0), longFrames: frames.filter((f) => f > 25).length };
};
window.__perfScroll = (direction, step, maxFrames) => new Promise((done) => {
  const el = window.__perfScroller();
  const frames = [];
  let last = 0, count = 0;
  const tick = (now) => {
    if (last) frames.push(now - last);
    last = now;
    if (direction < 0) el.dispatchEvent(new WheelEvent('wheel', { deltaY: -step, bubbles: true }));
    el.scrollTop += direction * step;
    count++;
    const end = direction < 0 ? el.scrollTop <= 0 : el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    if (end || count >= maxFrames) done(window.__perfFrames(frames));
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
window.__perfMemory = () => {
  window.gc?.(); window.gc?.();
  return {
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null,
    domNodes: document.getElementsByTagName('*').length,
    renderedRows: document.querySelectorAll('[role="log"] [data-mid]').length,
  };
};
true;
`;

async function runAsync<T>(context: Context, expression: string, timeoutMs = 300_000): Promise<T> {
  const key = `__perfJob${Date.now()}`;
  await context.evaluate(`window.${key} = undefined; Promise.resolve(${expression}).then((value) => { window.${key} = { value }; }, (error) => { window.${key} = { error: String(error) }; }); true`);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const result = await context.evaluate<{ value?: T; error?: string } | null>(`window.${key} ?? null`);
    if (result?.error) throw new Error(result.error);
    if (result && "value" in result) return result.value as T;
    await sleep(250);
  }
  throw new Error(`${expression} did not finish`);
}

const STREAM_REPLY = Array.from({ length: 12 }, (_, index) =>
  `Step ${index + 1}: I checked the **build output** and the \`server/\` logs, then compared the numbers with last week's run. ` +
  `Nothing regressed; the cache hit rate held at ${80 + index}% and the slowest route stayed under budget.`).join("\n\n");

async function streamScenario(runs: number) {
  const dir = mkdtempSync(join(tmpdir(), "dusk-perf-tools-"));
  const toolsFile = join(dir, "tools.json");
  writeFileSync(toolsFile, JSON.stringify([
    { name: "Bash", input: { command: "pnpm build" }, ok: true, output: "built in 4.2s" },
    { name: "Read", input: { file_path: "server/index.ts" }, ok: true, output: "export {}" },
    { name: "Grep", input: { pattern: "TODO", path: "src" }, ok: true, output: "src/App.tsx:12" },
    { name: "Bash", input: { command: "pnpm test" }, ok: true, output: "42 passed" },
    { name: "WebSearch", input: { query: "react 19 useSyncExternalStore" }, ok: true, output: "3 results" },
    { name: "Edit", input: { file_path: "src/App.tsx" }, ok: true, output: "edited" },
    { name: "Bash", input: { command: "git status" }, ok: true, output: "clean" },
    { name: "Read", input: { file_path: "README.md" }, ok: true, output: "# dusk bot" },
  ]));
  const replyFile = join(dir, "reply.md");
  writeFileSync(replyFile, STREAM_REPLY);
  return withFixture({
    FAKE_CLAUDE_TOOL_CALLS_FILE: toolsFile,
    FAKE_CLAUDE_STREAM_CADENCE: "6:16",
    FAKE_CLAUDE_REPLY_FILE: replyFile,
  }, async (context) => {
    note("stream: seeding history");
    for (let turn = 0; turn < 8; turn++) await send(context, `History turn ${turn + 1}: walk me through the release checklist.`);
    await holdOpen(context);
    await openTranscript(context);
    await context.evaluate(PAGE_HELPERS);
    await context.evaluate(`window.__perfScroller().scrollTop = 1e9; true`);
    await sleep(2_000);
    const readings = [];
    for (let run = 0; run < runs; run++) {
      await context.evaluate(`window.__duskPerf.reset(); true`);
      await send(context, `Measured turn ${run + 1}: run the build, the tests and summarise.`);
      await sleep(1_500);
      readings.push(await context.evaluate(`window.__duskPerf.read()`));
      note(`stream: run ${run + 1} done`);
    }
    const { bots } = await context.api("GET", "/api/bots?messages=12") as { bots: Array<{ id: string; messages?: Array<{ role: string; kind: string; text?: string }> }> };
    const tail = bots.find((bot) => bot.id === context.botId)?.messages?.map((message) => `${message.role}:${message.kind}:${message.text?.length ?? 0}`);
    // another bot works while Pepper's chat stays open: its frames reach the sidebar, not this transcript
    const other = await runControlDusk(["new-bot", "--name", "Quill", "--url", context.fixture.info.url]) as { bot: { id: string } };
    await sleep(3_000);
    const background = [];
    for (let run = 0; run < runs; run++) {
      await context.evaluate(`window.__duskPerf.reset(); true`);
      await send(context, `Background turn ${run + 1}: run the build and summarise.`, other.bot.id);
      await sleep(1_500);
      background.push(await context.evaluate(`window.__duskPerf.read()`));
      note(`stream: background run ${run + 1} done`);
    }
    return { history: await threadCount(context), tail, readings, background };
  });
}

const LONG_TEXTS = [
  "Here is the plan for today:\n\n1. Read the failing test\n2. Reproduce it locally\n3. Fix the race in the queue\n\nI'll report back after each step.",
  "The query takes **312 ms** on the cold cache and 41 ms warm. The slow part is the join on `messages.thread_id`; an index there should help.",
  "```ts\nexport function sum(values: number[]): number {\n  return values.reduce((total, value) => total + value, 0);\n}\n```\nThat's the helper, with a test beside it.",
  "Done. The deploy finished, the health check is green, and the error rate is back to its usual 0.02%.",
];

async function longScenario(target: number) {
  const perTurn = 80;
  const script = Array.from({ length: perTurn }, (_, index) => index % 2
    ? { tool: { name: index % 4 === 1 ? "Bash" : "Read", input: index % 4 === 1 ? { command: `echo ${index}` } : { file_path: `src/file-${index}.ts` }, ok: true, output: "ok" } }
    : { text: LONG_TEXTS[(index / 2) % LONG_TEXTS.length]! });
  return withFixture({ FAKE_CLAUDE_SCRIPT: JSON.stringify(script) }, async (context) => {
    let total = 0;
    for (let turn = 0; total < target; turn++) {
      await send(context, `Turn ${turn + 1}: keep going with the next batch.`);
      total = await threadCount(context);
      note(`long: ${total} messages`);
    }
    await holdOpen(context);
    const openedAt = Date.now();
    await openTranscript(context);
    const openMs = Date.now() - openedAt;
    await context.evaluate(PAGE_HELPERS);
    await sleep(2_000);
    const initial = await context.evaluate(`window.__perfMemory()`);
    note("long: loading the whole transcript");
    let stable = 0;
    let lastHeight = -1;
    let lastRows = -1;
    for (let round = 0; round < 400 && stable < 8; round++) {
      const state = await context.evaluate<{ height: number; rows: number; loading: boolean }>(`(() => {
        const el = window.__perfScroller();
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true }));
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll'));
        return { height: el.scrollHeight, rows: document.querySelectorAll('[role="log"] [data-mid]').length, loading: Boolean(document.querySelector('[role="log"] .animate-spin')) };
      })()`);
      stable = state.height === lastHeight && state.rows === lastRows && !state.loading ? stable + 1 : 0;
      lastHeight = state.height;
      lastRows = state.rows;
      await sleep(400);
    }
    const loaded = await context.evaluate(`window.__perfMemory()`);
    const scrolls = [];
    for (let pass = 0; pass < 2; pass++) {
      await context.evaluate(`window.__duskPerf.reset(); true`);
      const down = await runAsync(context, `window.__perfScroll(1, 60, 4000)`);
      const downRenders = await context.evaluate(`window.__duskPerf.read()`);
      await context.evaluate(`window.__duskPerf.reset(); true`);
      const up = await runAsync(context, `window.__perfScroll(-1, 60, 4000)`);
      const upRenders = await context.evaluate(`window.__duskPerf.read()`);
      scrolls.push({ down, downRenders, up, upRenders });
    }
    const after = await context.evaluate(`window.__perfMemory()`);
    return { messages: total, openMs, initial, loaded, after, scrolls };
  });
}

const runs = Number(values.runs) || 3;
const result: Record<string, unknown> = { label: values.label, at: new Date().toISOString(), platform: `${process.platform}-${process.arch}` };
if (values.scenario === "all" || values.scenario === "stream") result.stream = await streamScenario(runs);
if (values.scenario === "all" || values.scenario === "long") result.long = await longScenario(Number(values.messages) || 2000);
const json = `${JSON.stringify(result, null, 2)}\n`;
if (values.out) writeFileSync(values.out, json);
process.stdout.write(json);
process.exit(0);
