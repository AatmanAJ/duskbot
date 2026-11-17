// How the phone app feels, in numbers: the production build on the stage.ts fixture in headless Chrome at 440 x 956 with
// the CPU slowed (4x by default), driven with real taps and touch scrolls. Each interaction reports tap to first motion and
// to landing, frames dropped, long tasks, React commits and the components they rendered, requests, calls over the native
// glass bridge (a recording stand-in), and style and layout work. `--video <dir>` also keeps the screencast of each chat
// switch for frame strips.
//
//   node --experimental-strip-types apps/mobile/store/perf.ts --out perf.json [--rate 4] [--runs 3] [--video dir]
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { startStage, js, type Stage } from "./stage.ts";
import { TEAM } from "./team.mjs";

const { values: args } = parseArgs({ options: { out: { type: "string" }, rate: { type: "string", default: "4" }, runs: { type: "string", default: "3" }, video: { type: "string" }, profile: { type: "string" } } });
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const RATE = Number(args.rate);
const RUNS = Number(args.runs);
const LONG = "Quill";

// a long chat to scroll and switch into: 180 messages of lists, code and links, as a working chat reads after a few weeks
const quill = TEAM.find((one) => one.name === LONG)!;
const long: Array<[string, string, number]> = [];
for (let i = 0; i < 180; i += 1) {
  const ago = 60 * 24 * 6 - i * 40;
  long.push(i % 2 === 0
    ? ["me", `draft ${i / 2 + 1}: can you tighten the intro and give me three options for the closing line?`, ago]
    : [LONG, `here's take ${(i + 1) / 2}:\n\n1. **lead with the result**, then the why\n2. cut the second paragraph to two lines\n3. end on the ask\n\n\`\`\`\nsubject: quick update on the launch\n\`\`\`\n\nthe closing options are in [the doc](https://example.com/doc/${i}). want me to send the shortest one?`, ago - 1]);
}
(quill as { chat: unknown[] }).chat = [...long, ...quill.chat];

const INSTRUMENT = `(() => {
  const perf = window.__perf = { frames: [], longtasks: [], commits: [], fetches: [], glass: [], walk: false, tapAt: 0, marks: {} };
  addEventListener("pointerdown", (e) => { perf.tapAt = performance.now(); }, { capture: true });
  const tick = (t) => { perf.frames.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) perf.longtasks.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true }); } catch {}
  perf.shifts = [];
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) perf.shifts.push([e.startTime, e.value]); }).observe({ type: "layout-shift", buffered: true }); } catch {}
  perf.fonts = [];
  document.fonts?.addEventListener("loadingdone", (e) => { for (const face of e.fontfaces) perf.fonts.push([performance.now(), face.family]); });
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    const entry = [performance.now(), String(url).replace(location.origin, ""), 0];
    perf.fetches.push(entry);
    return realFetch.apply(this, arguments).then((res) => { entry[2] = performance.now() - entry[0]; return res; });
  };
  const name = (t) => !t ? "?" : typeof t === "string" ? null : t.displayName || t.name || (t.type && (t.type.displayName || t.type.name)) || (t.render && (t.render.displayName || t.render.name)) || null;
  const count = (fiber, out) => {
    const stack = [fiber];
    while (stack.length) {
      const f = stack.pop();
      const prev = f.alternate;
      if ((typeof f.type === "function" || (f.type && typeof f.type === "object")) && (!prev || (f.flags & 1))) {
        const n = name(f.type);
        if (n) out[n] = (out[n] || 0) + 1;
      }
      if (prev && f.child === prev.child) { if (f.sibling) stack.push(f.sibling); continue; }
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject() { return 1; }, checkDCE() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {},
    onCommitFiberRoot(id, root) {
      const at = performance.now();
      const out = {};
      if (perf.walk) count(root.current.child, out);
      perf.commits.push([at, out]);
    },
  };
  const glass = (kind) => (state) => perf.glass.push([performance.now(), kind, state === undefined ? 0 : JSON.stringify(state).length]);
  window.__perfGlass = { update: glass("update"), setText: glass("text"), setAvatar: glass("avatar"), focus() {}, blur() {}, clear: glass("clear"), slide: glass("slide"), onEvent: (fn) => { perf.emit = fn; return () => {}; } };
  // the pushed page's position each frame, for when a slide starts and lands
  // read as drawn only while it may move (an inline transform changed, or keyframes run), so a resting page is not restyled
  let inline = null, x = null;
  const watch = () => {
    const el = document.querySelector(".mobile-page");
    if (!el) x = null;
    else if (el.style.transform !== inline || el.getAnimations().length) { inline = el.style.transform; x = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41; }
    const last = perf.pagePath?.at(-1);
    if (perf.pagePath && (!last || last[1] !== x)) perf.pagePath.push([performance.now(), x]);
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
})()`;

type Result = Record<string, number | string | Record<string, number> | string[]>;

async function metrics(stage: Stage): Promise<Record<string, number>> {
  const { metrics: list } = await stage.page.send("Performance.getMetrics");
  return Object.fromEntries(list.map((m: { name: string; value: number }) => [m.name, m.value]));
}

async function center(stage: Stage, selector: string): Promise<{ x: number; y: number }> {
  const box = await stage.page.evaluate(`(() => { const el = ${selector}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!box) throw new Error(`nothing at ${selector.slice(0, 100)}`);
  return box;
}

async function tap(stage: Stage, selector: string) {
  const { x, y } = await center(stage, selector);
  await stage.page.send("Input.synthesizeTapGesture", { x, y, duration: 40, gestureSourceType: "touch" });
}

const row = (name: string) => `[...document.querySelectorAll(".mobile-nav button")].find((el) => el.textContent.trim().toLowerCase().startsWith(${js(name.toLowerCase())}))`;
const BACK = `document.querySelector("[data-mobile-chat] [data-glass=back]")`;
const TITLE = `document.querySelector("[data-mobile-chat] [data-glass=title]")`;
const LOG = `document.querySelector("[data-mobile-chat] [role=log]")`;

/** Runs `act`, waits `settle` ms, and reports what the page did from the start of the window. */
async function measure(stage: Stage, label: string, act: () => Promise<void>, settle: number, walk = false): Promise<Result> {
  await stage.page.evaluate(`(() => { const p = window.__perf; p.walk = ${walk}; p.start = performance.now(); p.tapAt = 0; p.pagePath = []; p.frames.length = 0; p.longtasks.length = 0; p.commits.length = 0; p.fetches.length = 0; p.glass.length = 0; })()`);
  const before = await metrics(stage);
  await act();
  await delay(settle);
  const after = await metrics(stage);
  const page = await stage.page.evaluate(`(() => {
    const p = window.__perf, from = p.start, tap = p.tapAt || from;
    const frames = p.frames.filter((t) => t >= from);
    const gaps = frames.slice(1).map((t, i) => t - frames[i]);
    const longtasks = p.longtasks.filter(([s]) => s >= from);
    const rendered = {};
    for (const [, out] of p.commits) for (const [k, v] of Object.entries(out)) rendered[k] = (rendered[k] || 0) + v;
    const path = p.pagePath;
    const width = innerWidth;
    const moved = path.find(([, x]) => x !== null && x < width - 0.5 && x > 0.5);
    const landed = path.find(([t, x]) => x !== null && Math.abs(x) < 0.5 && (!moved || t >= moved[0]));
    const gone = path.find(([, x]) => x === null || x >= width - 0.5);
    return {
      tapToMove: moved ? Math.round(moved[0] - tap) : -1,
      tapToLand: landed ? Math.round(landed[0] - tap) : -1,
      tapToGone: gone ? Math.round(gone[0] - tap) : -1,
      frames: frames.length,
      dropped: gaps.reduce((n, g) => n + Math.max(0, Math.round(g / 16.67) - 1), 0),
      worstFrame: Math.round(Math.max(0, ...gaps)),
      longTasks: longtasks.length,
      longTaskMs: Math.round(longtasks.reduce((n, [, d]) => n + d, 0)),
      worstTask: Math.round(Math.max(0, ...longtasks.map(([, d]) => d))),
      commits: p.commits.length,
      fibers: Object.values(rendered).reduce((a, b) => a + b, 0),
      topRendered: Object.fromEntries(Object.entries(rendered).sort((a, b) => b[1] - a[1]).slice(0, 12)),
      requests: p.fetches.length,
      requestUrls: p.fetches.map(([, u, d]) => u.split("?")[0] + " " + Math.round(d) + "ms"),
      glassUpdates: p.glass.filter(([, k]) => k === "update").length,
      glassAvatars: p.glass.filter(([, k]) => k === "avatar").length,
      glassSlides: p.glass.filter(([, k]) => k === "slide").length,
      glassBytes: p.glass.reduce((n, [, , b]) => n + b, 0),
    };
  })()`);
  const d = (k: string) => Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * (k.endsWith("Duration") ? 1000 : 1));
  const result: Result = { label, ...page, layouts: d("LayoutCount"), styleRecalcs: d("RecalcStyleCount"), layoutMs: d("LayoutDuration"), styleMs: d("RecalcStyleDuration"), scriptMs: d("ScriptDuration") };
  console.log(`${label}: ${JSON.stringify(Object.fromEntries(Object.entries(result).filter(([k]) => !["topRendered", "requestUrls", "label"].includes(k))))}`);
  return result;
}

const landed = (stage: Stage) => stage.page.until(`(() => { const el = document.querySelector(".mobile-page"); return el && Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41) < 0.5 && ${LOG}; })()`, 15_000);
const home = (stage: Stage) => stage.page.until(`!document.querySelector(".mobile-page")`, 15_000);

async function openChat(stage: Stage, name: string, walk = false) {
  const result = await measure(stage, `home -> ${name}`, async () => { await tap(stage, row(name)); await landed(stage); }, 600, walk);
  return result;
}
async function back(stage: Stage, walk = false) {
  return measure(stage, "chat -> back", async () => { await tap(stage, BACK); await home(stage); }, 400, walk);
}

/** The screencast of one chat switch, frame by frame with their times from the tap. */
async function recordSwitch(stage: Stage, name: string, dir: string) {
  mkdirSync(dir, { recursive: true });
  const frames: Array<{ at: number; data: string }> = [];
  const off = stage.page.on("Page.screencastFrame", (frame) => {
    frames.push({ at: frame.metadata.timestamp * 1000, data: frame.data });
    void stage.page.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
  });
  await stage.page.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 440, maxHeight: 956, everyNthFrame: 1 });
  await delay(400);
  await stage.page.evaluate(`window.__perf.tapAt = 0`);
  await tap(stage, row(name));
  await landed(stage).catch(() => {});
  await delay(700);
  await stage.page.send("Page.stopScreencast");
  off();
  const tapEpoch = await stage.page.evaluate(`performance.timeOrigin + window.__perf.tapAt`);
  const list = frames.map((frame, i) => {
    const file = join(dir, `${String(i).padStart(3, "0")}.jpg`);
    writeFileSync(file, Buffer.from(frame.data, "base64"));
    return { file, ms: Math.round(frame.at - tapEpoch) };
  });
  writeFileSync(join(dir, "frames.json"), JSON.stringify(list, null, 2));
}

console.log("building the phone app");
const out = join(tmpdir(), `dusk-perf-build-${process.pid}`);
const build = spawnSync(join(repoRoot, "node_modules/.bin/vite"), ["build", "--config", "apps/mobile/store/perf.vite.config.ts", "--logLevel", "warn"], { cwd: repoRoot, env: { ...process.env, DUSK_PERF_OUT: out }, stdio: "inherit" });
if (build.status !== 0) process.exit(1);
process.env.DUSK_PERF_OUT = out;

const stage = await startStage({ args: ["preview", "--config", "apps/mobile/store/perf.vite.config.ts"], ready: "Local" });
const results: Result[] = [];
try {
  await stage.page.send("Performance.enable");
  await stage.page.send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  await stage.home("light");
  await stage.page.send("Emulation.setCPUThrottlingRate", { rate: RATE });

  // cold start: a reload to the chat list on screen
  await stage.page.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await stage.page.evaluate(`location.reload()`);
  await stage.page.until(`window.__perf && ${row("Nova")}`, 30_000);
  await delay(3000);
  await stage.page.send("Emulation.setCPUThrottlingRate", { rate: RATE });
  const cold = await stage.page.evaluate(`(() => { const nav = performance.getEntriesByType("navigation")[0]; const fcp = performance.getEntriesByName("first-contentful-paint")[0]; const p = window.__perf; return { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), firstContentfulPaint: Math.round(fcp?.startTime ?? -1), requests: p.fetches.length, layoutShift: Math.round(p.shifts.reduce((n, [, v]) => n + v, 0) * 1000) / 1000, shifts: p.shifts.length, fontsLoadedAt: p.fonts.map(([t, f]) => f + " " + Math.round(t)) }; })()`);
  console.log(`cold start (unthrottled): ${JSON.stringify(cold)}`);
  results.push({ label: "cold start (unthrottled)", ...cold });

  for (let run = 0; run < RUNS; run += 1) {
    const walk = run === RUNS - 1;
    results.push(await openChat(stage, LONG, walk));
    results.push(await back(stage, walk));
    results.push(await openChat(stage, "Nova", walk));
    results.push(await back(stage, walk));
  }

  await openChat(stage, LONG);
  results.push(await measure(stage, "idle chat, 2 s", async () => {}, 2000, true));
  results.push(await measure(stage, `scroll ${LONG}`, async () => {
    const { x, y } = { x: 220, y: 480 };
    await stage.page.send("Input.synthesizeScrollGesture", { x, y, yDistance: 4000, speed: 2400, gestureSourceType: "touch", repeatCount: 1 });
  }, 500, true));
  results.push(await measure(stage, `scroll ${LONG} back down`, async () => {
    const { x, y } = { x: 220, y: 480 };
    await stage.page.send("Input.synthesizeScrollGesture", { x, y, yDistance: -4000, speed: 2400, gestureSourceType: "touch", repeatCount: 1 });
  }, 500, true));
  await back(stage);

  await openChat(stage, "Nova");
  results.push(await measure(stage, "send a message (and its reply)", async () => {
    // typed and sent through the glass bridge, as the native composer does
    await stage.page.evaluate(`window.__perf.emit({ type: "text", text: "what's on for tomorrow?" })`);
    await delay(300);
    await stage.page.evaluate(`window.__perf.emit({ type: "button", index: 0, kind: "send" })`);
    await stage.page.until(`[...document.querySelectorAll("[data-mobile-chat] [data-message-row]")].some((row) => row.textContent.includes("on for tomorrow"))`, 5000);
  }, 5000, true));
  results.push(await measure(stage, "open the bot sheet", async () => {
    await tap(stage, TITLE);
    await stage.page.until(`[...document.querySelectorAll("[role=dialog]")].some((el) => el.getBoundingClientRect().width > 0)`, 10_000);
  }, 800, true));

  if (args.profile) {
    // where the page thread's time goes while a long chat opens: self time by function, heaviest first
    await stage.home("light");
    await stage.page.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    await stage.page.send("Profiler.enable");
    await stage.page.send("Profiler.setSamplingInterval", { interval: 200 });
    await stage.page.send("Profiler.start");
    await openChat(stage, LONG);
    const { profile } = await stage.page.send("Profiler.stop");
    await back(stage);
    writeFileSync(args.profile, JSON.stringify(profile));
    const spent = new Map<number, number>();
    profile.samples.forEach((id: number, i: number) => spent.set(id, (spent.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
    const self = new Map<string, number>();
    for (const node of profile.nodes) {
      const { functionName, url, lineNumber } = node.callFrame;
      const key = `${functionName || "(anonymous)"} ${String(url).split("/").pop()}:${lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (spent.get(node.id) ?? 0));
    }
    for (const [key, ms] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${ms.toFixed(1).padStart(8)} ms  ${key}`);
  }

  if (args.video) {
    await stage.home("light");
    await stage.page.send("Emulation.setCPUThrottlingRate", { rate: RATE });
    await recordSwitch(stage, LONG, join(args.video, "long-chat"));
    await tap(stage, BACK);
    await home(stage);
    await delay(800);
    await recordSwitch(stage, "Nova", join(args.video, "short-chat"));
  }
} finally {
  if (args.out) writeFileSync(args.out, JSON.stringify({ rate: RATE, runs: RUNS, at: new Date().toISOString(), results }, null, 2));
  await stage.stop();
}
process.exit(0);
