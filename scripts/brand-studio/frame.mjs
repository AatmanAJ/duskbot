#!/usr/bin/env node
import electron from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { OPTIONS_FILE, planReframe } from "./jobs.mjs";
import { ARRANGEMENTS, BACKGROUNDS, parseCrop } from "./layout.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));

const HELP = `brand screen studio: a raw app screenshot on a dusk bot brand background

  node scripts/brand-studio/frame.mjs --in RAW.png --out FRAMED.png [--bg 1|2|3]
  node scripts/brand-studio/frame.mjs --in BEFORE.png --in AFTER.png --out PAIR.png --label before --label after [--arrange auto|row|stack]
  node scripts/brand-studio/frame.mjs --in RAW.png --out FRAMED.png --crop 40,120,560,360
  node scripts/brand-studio/frame.mjs --in F1.png --in F2.png [--in ...] --out DEMO.gif [--hold 1400] [--fade 320]
  node scripts/brand-studio/frame.mjs --reframe DIR [--bg 1|2|3]

  --in PATH        a raw screenshot; repeat it for a pair on one PNG or for the frames of a GIF
  --out PATH       .png for a still, .gif for a looping animation
  --bg N           1 sky (default), 2 dunes, 3 birches
  --label TEXT     one per --in, in order; on a PNG the last one carries the red dot, on a GIF they all do
  --arrange MODE   several --in on a PNG: row (side by side), stack (one above the other), or auto (default):
                   the row while it stays readable at the 900 px a pull request shows it at, the stack otherwise
  --crop X,Y,W,H   the part of a screenshot to keep, in points from its top left; one for every --in, or one per --in
  --density N      pixels per point of the raw screenshots (default 2, a retina capture)
  --pad POINTS     space around the screenshots (default: about 8.5% of their width, 72 to 160)
  --hold MS        how long a GIF rests on each frame (default 1400)
  --fade MS        cross-fade between GIF frames; 0 cuts (default 320)
  --gif-width PX   widest a GIF may be; larger canvases are scaled down (default 1280)
  --reframe DIR    frame every <slug>.<state>.raw.png and pr-<n>-before|after.png in DIR by the naming convention
                   in docs/brand-studio.md, with the crops and arrangements in its frame.json, if it has one
`;

class UsageError extends Error {}

function number(values, name, fallback, { min = 0 } = {}) {
  if (values[name] === undefined) return fallback;
  const parsed = Number(values[name]);
  if (!Number.isFinite(parsed) || parsed < min) throw new UsageError(`--${name} must be a number of at least ${min}`);
  return parsed;
}

function fail(message) {
  throw new UsageError(message);
}

function planFolder(dir) {
  const optionsPath = join(dir, OPTIONS_FILE);
  try {
    return planReframe(dir, readdirSync(dir), existsSync(optionsPath) ? JSON.parse(readFileSync(optionsPath, "utf8")) : {});
  } catch (error) {
    throw new UsageError(error.message);
  }
}

function readJobs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      in: { type: "string", multiple: true },
      out: { type: "string" },
      bg: { type: "string", default: "1" },
      label: { type: "string", multiple: true },
      arrange: { type: "string", default: "auto" },
      crop: { type: "string", multiple: true },
      density: { type: "string" },
      pad: { type: "string" },
      hold: { type: "string" },
      fade: { type: "string" },
      "gif-width": { type: "string" },
      reframe: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return null;
  if (!Object.hasOwn(BACKGROUNDS, values.bg)) throw new UsageError(`--bg must be one of ${Object.keys(BACKGROUNDS).join(", ")}`);
  if (!ARRANGEMENTS.includes(values.arrange)) throw new UsageError(`--arrange must be one of ${ARRANGEMENTS.join(", ")}`);
  const shared = {
    arrange: values.arrange,
    background: join(HERE, "backgrounds", BACKGROUNDS[values.bg]),
    density: number(values, "density", 2, { min: 1 }),
    pad: values.pad === undefined ? null : number(values, "pad", 0),
    holdMs: number(values, "hold", 1400, { min: 20 }),
    fadeMs: number(values, "fade", 320),
    gifWidth: number(values, "gif-width", 1280, { min: 64 }),
  };

  if (values.reframe !== undefined) {
    if (values.in || values.out || values.label || values.crop) throw new UsageError("--reframe takes a folder and no --in, --out, --label or --crop");
    const dir = resolve(values.reframe);
    if (!existsSync(dir)) throw new UsageError(`no such folder: ${dir}`);
    const planned = planFolder(dir);
    if (!planned.length) throw new UsageError(`no <slug>.<state>.raw.png or pr-<n>-before|after.png files in ${dir}`);
    return planned.map((job) => ({ ...shared, ...job }));
  }

  const shots = (values.in ?? []).map((path) => resolve(path));
  if (!shots.length || !values.out) throw new UsageError("give --in and --out, or --reframe DIR");
  for (const shot of shots) if (!existsSync(shot)) throw new UsageError(`no such file: ${shot}`);
  const out = resolve(values.out);
  const type = extname(out).toLowerCase();
  if (type !== ".png" && type !== ".gif") throw new UsageError("--out must end in .png or .gif");
  if (type === ".gif" && shots.length < 2) throw new UsageError("a .gif needs at least two --in frames");
  const labels = values.label ?? [];
  if (labels.length && labels.length !== shots.length) throw new UsageError("give one --label per --in, or none");
  const given = (values.crop ?? []).map((text) => parseCrop(text) ?? fail(`--crop must be X,Y,W,H in points, not ${text}`));
  if (given.length > 1 && given.length !== shots.length) throw new UsageError("give one --crop for every --in, or one per --in");
  const crops = shots.map((_, index) => (given.length > 1 ? given[index] : given[0]) ?? null);
  return [{ ...shared, kind: type === ".gif" ? "animation" : "still", shots, labels, crops, out }];
}

async function renderJobs(jobs) {
  for (const job of jobs) mkdirSync(dirname(job.out), { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), "dusk-brand-studio-"));
  try {
    writeFileSync(join(workDir, "jobs.json"), JSON.stringify({ jobs }));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [join(HERE, "render-electron.mjs"), workDir], { stdio: ["ignore", "inherit", "inherit"], env });
    const timer = setTimeout(() => child.kill("SIGKILL"), 300_000);
    const code = await new Promise((done) => child.on("exit", (status) => done(status ?? 1)));
    clearTimeout(timer);
    // Electron's exit can drop piped output: the child writes its report to a file.
    let result;
    try { result = JSON.parse(readFileSync(join(workDir, "result.json"), "utf8")); } catch { result = { ok: false, error: `the renderer exited with ${code} and no report` }; }
    return result;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  const jobs = readJobs(process.argv.slice(2));
  if (!jobs) {
    process.stdout.write(HELP);
  } else {
    const result = await renderJobs(jobs);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  }
} catch (error) {
  if (!(error instanceof UsageError) && error?.code !== "ERR_PARSE_ARGS_UNKNOWN_OPTION") throw error;
  process.stderr.write(`${error.message}\n\n${HELP}`);
  process.exitCode = 2;
}
