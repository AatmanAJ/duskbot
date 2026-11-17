// Turns the raw captures in pr-media/data into the small data files the scenes load (scenes run from file://, so plain
// scripts that set globals, not fetches).
//   node --experimental-strip-types pr-media/capture/prepare.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(dirname(fileURLToPath(import.meta.url)), "..");
type Frame = { t: number; kind: string; bytes: number; frame?: Record<string, unknown>; event?: { type?: string; threadId?: string } };
const streams = JSON.parse(readFileSync(join(HERE, "data", "streams.json"), "utf8")) as { targets: Array<{ bot: string; thread: string }>; protocol1: Frame[]; protocol2: Frame[] };
const KINDS = ["bot", "bot.patch", "task.patch", "runtime", "message", "message.patch", "notify"];
const rowOf = (frame: Frame) => {
  const f = frame.frame as { bot?: { id?: string }; id?: string; botId?: string; threadId?: string } | undefined;
  const thread = frame.event?.threadId ?? f?.threadId;
  const byThread = streams.targets.findIndex((target) => target.thread === thread);
  if (byThread >= 0) return byThread;
  const bot = f?.bot?.id ?? f?.id ?? f?.botId;
  const byBot = streams.targets.findIndex((target) => target.bot === bot);
  return byBot >= 0 ? byBot : -1;
};
const compact = (frames: Frame[]) => frames.filter((f) => KINDS.includes(f.kind)).map((f) => [Math.round(f.t * 1000) / 1000, KINDS.indexOf(f.kind), f.bytes, rowOf(f)]);
const sum = (frames: Frame[], kinds: string[]) => frames.filter((f) => kinds.includes(f.kind)).reduce((total, f) => total + f.bytes, 0);
const BOT = ["bot", "bot.patch", "task.patch"];
const whole = streams.protocol1.find((f) => f.kind === "bot" && JSON.stringify(f.frame).includes('"busy":true'))!;
const taskPatch = streams.protocol2.find((f) => f.kind === "task.patch" && JSON.stringify(f.frame).includes('"busy"'))
  ?? streams.protocol2.find((f) => f.kind === "task.patch")!;
const botPatch = streams.protocol2.find((f) => f.kind === "bot.patch")!;
const patchBot = (taskPatch.frame as { botId: string }).botId;
// the whole frame protocol 1 sent for that same change: same bot, nearest moment
const wholeMatch = streams.protocol1.filter((f) => f.kind === "bot" && (f.frame as { bot: { id: string } }).bot.id === patchBot)
  .sort((a, b) => Math.abs(a.t - taskPatch.t) - Math.abs(b.t - taskPatch.t))[0]!;
writeFileSync(join(HERE, "scenes", "data", "streams.js"), `window.STREAMS = ${JSON.stringify({
  kinds: KINDS, rows: streams.targets.length, protocol1: compact(streams.protocol1), protocol2: compact(streams.protocol2),
  totals: { p1: sum(streams.protocol1, KINDS), p2: sum(streams.protocol2, KINDS), p1bot: sum(streams.protocol1, BOT), p2bot: sum(streams.protocol2, BOT) },
  samples: { whole: { bytes: whole.bytes, frame: whole.frame }, wholeMatch: { bytes: wholeMatch.bytes, t: wholeMatch.t, frame: wholeMatch.frame }, patchT: taskPatch.t, taskPatch: { bytes: taskPatch.bytes, frame: taskPatch.frame }, botPatch: { bytes: botPatch.bytes, frame: botPatch.frame } },
})};\n`);
const app = JSON.parse(readFileSync(join(HERE, "data", "app.json"), "utf8")) as { shots: Array<{ t: number; file: string }>; settledAt: number; streamUrls: string[]; snapshotReads: string[]; tap: Array<{ t: number; kind: string; bytes: number; type?: string }> };
writeFileSync(join(HERE, "scenes", "data", "app.js"), `window.APP = ${JSON.stringify(app)};\n`);
console.log(JSON.stringify({ p1: streams.protocol1.length, p2: streams.protocol2.length, wholeBytes: whole.bytes, taskPatchBytes: taskPatch.bytes, botPatchBytes: botPatch.bytes,
  taskPatch: taskPatch.frame, botPatch: botPatch.frame }));
