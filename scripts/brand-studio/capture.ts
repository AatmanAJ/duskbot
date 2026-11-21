// Run with: node --experimental-strip-types scripts/brand-studio/capture.ts --view chat --slug my-change --state after
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { agentBrowser, runControlDuskUi, sessionEnv, type UiHandle } from "../testing/control-dusk-ui.ts";
import { fixtureApi } from "../testing/preview-fixture.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** One thing done to the page before or between screenshots. */
export type CaptureStep =
  | { click: string }
  | { type: { name: string; text: string } }
  | { press: string }
  /** Wait until the seeded bot's turn has settled, at most this many seconds. */
  | { settle: number }
  | { waitMs: number }
  | { eval: string }
  /** Screenshot now, as `<slug>.<shot>.raw.png`. */
  | { shot: string };

export interface CaptureView {
  /** A `control-dusk ui launch --entry`. */
  entry: "threads" | "settings" | "dictation";
  /** A fake-engine turn, as `ui launch --script` takes it. */
  script?: unknown[];
  steps: CaptureStep[];
}

const REPLY_SCRIPT = [
  { text: "On it." },
  { tool: { name: "Bash", input: { command: "python scraper.py" } } },
  { text: "Done. 42 prices saved to prices.csv." },
];
const SEND_HELLO: CaptureStep[] = [
  { type: { name: "Message Pepper", text: "Check today's prices and save them" } },
  { press: "Enter" },
  { settle: 60 },
];

export const VIEWS: Record<string, CaptureView> = {
  chat: { entry: "threads", steps: [] },
  "chat-draft": { entry: "threads", steps: [{ type: { name: "Message Pepper", text: "Check today's prices and save them" } }] },
  "chat-reply": { entry: "threads", script: REPLY_SCRIPT, steps: SEND_HELLO },
  "chat-demo": {
    entry: "threads",
    script: REPLY_SCRIPT,
    steps: [
      { shot: "f01-open" },
      { type: { name: "Message Pepper", text: "Check today's prices and save them" } },
      { shot: "f02-ask" },
      { press: "Enter" },
      { settle: 60 },
      { shot: "f03-reply" },
    ],
  },
};

const HELP = `brand screen studio: screenshot a named app view on an isolated fixture

  node --experimental-strip-types scripts/brand-studio/capture.ts --view NAME --slug SLUG [--state after] [--out-dir qa-assets]
  node --experimental-strip-types scripts/brand-studio/capture.ts --steps STEPS.json --slug SLUG [--entry threads] [--script JSON]

  --view NAME      one of: ${Object.keys(VIEWS).join(", ")}
  --steps FILE     a JSON array of steps instead of a named view:
                   {"click": NAME} {"type": {"name": NAME, "text": TEXT}} {"press": KEYS}
                   {"settle": SECONDS} {"waitMs": MS} {"eval": JS} {"shot": STATE}
  --entry NAME     the preview page for --steps: threads (default), settings, dictation
  --script JSON    the fake engine's turn for --steps, as \`control-dusk ui launch --script\` takes it
  --slug SLUG      what the capture shows, in lowercase-with-hyphens
  --state STATE    before, after or any lowercase-with-hyphens word (default after); views that take their own shots ignore it
  --out-dir DIR    where <slug>.<state>.raw.png goes (default qa-assets)
  --width PX, --height PX, --scale N   the window, in points, and its pixels per point (default 1280, 800, 2)
`;

const WORD = /^[a-z0-9][a-z0-9-]*$/;

/** True in the page once the entry has drawn what a capture starts from. */
const READY: Record<CaptureView["entry"], string> = {
  threads: "!!document.querySelector('textarea')",
  settings: "document.readyState === 'complete' && !!document.querySelector('button')",
  dictation: "document.readyState === 'complete' && !!document.querySelector('button')",
};

class UsageError extends Error {}

async function launchFixture(view: CaptureView): Promise<{ child: ChildProcess; handlePath: string }> {
  const args = ["--experimental-strip-types", join(ROOT, "scripts/control-dusk.ts"), "ui", "launch", "--entry", view.entry];
  if (view.script) args.push("--script", JSON.stringify(view.script));
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const handlePath = await new Promise<string>((done, fail) => {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      try { done((JSON.parse(stdout) as { ui: string }).ui); } catch { /* the handle is still arriving */ }
    });
    child.once("exit", (code) => fail(new Error(`the fixture ended before it was ready (exit ${code}): ${stderr.slice(-600)}`)));
  });
  return { child, handlePath };
}

async function stopFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGINT");
  await exited;
}

export async function capture(options: {
  view: CaptureView; slug: string; state: string; outDir: string; width: number; height: number; scale: number;
}): Promise<string[]> {
  mkdirSync(options.outDir, { recursive: true });
  const { child, handlePath } = await launchFixture(options.view);
  const written: string[] = [];
  try {
    const handle = JSON.parse(readFileSync(handlePath, "utf8")) as UiHandle;
    const ui = (verb: string, ...args: string[]) => runControlDuskUi([verb, "--ui", handlePath, ...args]);
    const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
    const shoot = async (state: string) => {
      await ui("eval", "--js", "document.fonts.ready.then(() => true)");
      await pause(400);
      const out = join(options.outDir, `${options.slug}.${state}.raw.png`);
      await ui("screenshot", "--out", out);
      written.push(out);
    };
    await fixtureApi(handle.url)("PATCH", `/api/bots/${handle.botId}`, { color: "orange" });
    await agentBrowser(handle.binary, sessionEnv(handle), ["set", "viewport", String(options.width), String(options.height), String(options.scale)]);
    await agentBrowser(handle.binary, sessionEnv(handle), ["set", "media", "dark", "reduced-motion"]);
    const deadline = Date.now() + 60_000;
    for (let steady = 0; steady < 6;) {
      if (Date.now() > deadline) throw new Error("the app did not finish loading within 60 seconds");
      await pause(250);
      steady = (await ui("eval", "--js", READY[options.view.entry]) as { result?: unknown }).result === true ? steady + 1 : 0;
    }
    for (const step of options.view.steps) {
      if ("click" in step) await ui("click", "--name", step.click);
      else if ("type" in step) await ui("type", "--name", step.type.name, "--text", step.type.text);
      else if ("press" in step) await ui("press", "--keys", step.press);
      else if ("settle" in step) await ui("wait-settle", "--timeout", String(step.settle));
      else if ("waitMs" in step) await pause(step.waitMs);
      else if ("eval" in step) await ui("eval", "--js", step.eval);
      else if ("shot" in step) {
        if (!WORD.test(step.shot)) throw new UsageError(`a shot's state must be lowercase-with-hyphens: ${step.shot}`);
        await shoot(step.shot);
      }
    }
    if (!written.length) await shoot(options.state);
  } finally {
    await stopFixture(child);
  }
  return written;
}

function readOptions(argv: string[]): Parameters<typeof capture>[0] | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      view: { type: "string" }, steps: { type: "string" }, entry: { type: "string", default: "threads" }, script: { type: "string" },
      slug: { type: "string" }, state: { type: "string", default: "after" }, "out-dir": { type: "string", default: "qa-assets" },
      width: { type: "string", default: "1280" }, height: { type: "string", default: "800" }, scale: { type: "string", default: "2" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return null;
  if (!values.slug || !WORD.test(values.slug)) throw new UsageError("--slug must be lowercase-with-hyphens");
  if (!WORD.test(values.state)) throw new UsageError("--state must be lowercase-with-hyphens");
  if ((values.view === undefined) === (values.steps === undefined)) throw new UsageError("give --view NAME or --steps FILE");
  let view: CaptureView;
  if (values.view !== undefined) {
    if (!Object.hasOwn(VIEWS, values.view)) throw new UsageError(`unknown --view ${values.view}; views: ${Object.keys(VIEWS).join(", ")}`);
    view = VIEWS[values.view];
  } else {
    if (values.entry !== "threads" && values.entry !== "settings" && values.entry !== "dictation") throw new UsageError("--entry must be threads, settings or dictation");
    const steps = JSON.parse(readFileSync(resolve(values.steps as string), "utf8")) as CaptureStep[];
    if (!Array.isArray(steps)) throw new UsageError("--steps must hold a JSON array");
    view = { entry: values.entry, steps, ...(values.script ? { script: JSON.parse(values.script) as unknown[] } : {}) };
  }
  const size = (name: "width" | "height" | "scale", min: number, max: number) => {
    const parsed = Number(values[name]);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
    return parsed;
  };
  return {
    view, slug: values.slug, state: values.state, outDir: resolve(values["out-dir"]),
    width: size("width", 320, 3840), height: size("height", 320, 2400), scale: size("scale", 1, 3),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = readOptions(process.argv.slice(2));
    if (!options) process.stdout.write(HELP);
    else process.stdout.write(`${JSON.stringify({ ok: true, written: await capture(options) }, null, 2)}\n`);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${HELP}`);
      process.exitCode = 2;
    } else {
      process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
      process.exitCode = 1;
    }
  }
}
