// Run with: node --experimental-strip-types scripts/brand-studio/capture.ts --view chat --slug my-change --state after
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { agentBrowser, runControlDuskUi, sessionEnv, type UiHandle } from "../testing/control-dusk-ui.ts";
import { fixtureApi } from "../testing/preview-fixture.ts";
import { dataFilePath, ENTRIES, fill, plannedShots, readRecipe, readSteps, WORD, type CaptureStep, type CaptureView } from "./recipe.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

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

const HELP = `brand screen studio: screenshot an app view on an isolated fixture

  node --experimental-strip-types scripts/brand-studio/capture.ts --view NAME --slug SLUG [--state after] [--out-dir qa-assets]
  node --experimental-strip-types scripts/brand-studio/capture.ts --steps STEPS.json --slug SLUG [--entry threads] [--script JSON]
  node --experimental-strip-types scripts/brand-studio/capture.ts --recipe DIR/SLUG.capture.json --app before=BASE_CHECKOUT --app after=.

  --view NAME      one of: ${Object.keys(VIEWS).join(", ")}
  --steps FILE     a JSON array of steps instead of a named view:
                   {"click": NAME} {"type": {"name": NAME, "text": TEXT}} {"press": KEYS}
                   {"settle": SECONDS} {"waitMs": MS} {"waitFor": JS} {"eval": JS} {"reload": true}
                   {"appendRows": {"file": PATH, "rows": [...]}} {"shot": STATE or true}
                   any step may add "only": STATE
  --recipe FILE    a <slug>.capture.json: the entry, the engine's turn, the colour, the window and the steps;
                   the raw files go beside it
  --app [STATE=]DIR  the checkout whose app is captured (default: this one). Repeat with a state each,
                   before=DIR and after=DIR, to capture a pair in step from two checkouts
  --entry NAME     the preview page for --steps: ${ENTRIES.join(", ")} (default threads)
  --script JSON    the fake engine's turn for --steps, as \`control-dusk ui launch --script\` takes it
  --slug SLUG      what the capture shows, in lowercase-with-hyphens (default: the recipe's file name)
  --state STATE    before, after or any lowercase-with-hyphens word (default after), for an --app with no state
  --out-dir DIR    where <slug>.<state>.raw.png goes (default qa-assets, or the recipe's folder)
  --color NAME     the seeded bot's colour (default orange)
  --width PX, --height PX, --scale N   the window, in points, and its pixels per point (default 1280, 800, 2)
`;

/** True in the page once the entry has drawn what a capture starts from. */
const READY: Record<CaptureView["entry"], string> = {
  threads: "!!document.querySelector('textarea')",
  settings: "document.readyState === 'complete' && !!document.querySelector('button')",
  dictation: "document.readyState === 'complete' && !!document.querySelector('button')",
};

/** Waits for the fonts and hides the text caret, which blinks: two shots of one view would differ by it. */
const STEADY_PAGE = "(document.getElementById('capture-steady') ?? document.head.appendChild(Object.assign(document.createElement('style'), { id: 'capture-steady', textContent: '* { caret-color: transparent !important; }' })), document.fonts.ready.then(() => true))";

class UsageError extends Error {}

export interface CaptureApp {
  state: string;
  /** The checkout whose app this state shows. */
  root: string;
}

interface Session {
  state: string;
  child: ChildProcess;
  handle: UiHandle;
  ui(verb: string, ...args: string[]): Promise<unknown>;
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function launchFixture(view: CaptureView, app: CaptureApp): Promise<Session> {
  const args = ["--experimental-strip-types", join(app.root, "scripts/control-dusk.ts"), "ui", "launch", "--entry", view.entry];
  if (view.script) args.push("--script", JSON.stringify(view.script));
  if (view.toolCalls) args.push("--tool-calls", JSON.stringify(view.toolCalls));
  const child = spawn(process.execPath, args, { cwd: app.root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const handlePath = await new Promise<string>((done, fail) => {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        try { done((JSON.parse(stdout) as { ui: string }).ui); } catch { /* the handle is still arriving */ }
      });
      child.once("exit", (code) => fail(new Error(`the ${app.state} fixture ended before it was ready (exit ${code}): ${stderr.slice(-600)}`)));
    });
    const handle = JSON.parse(readFileSync(handlePath, "utf8")) as UiHandle;
    return { state: app.state, child, handle, ui: (verb, ...rest) => runControlDuskUi([verb, "--ui", handlePath, ...rest]) };
  } catch (error) {
    await stopFixture(child);
    throw error;
  }
}

async function stopFixture(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGINT");
  await exited;
}

async function untilTrue(session: Session, js: string, what: string, steadyChecks = 1, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (let steady = 0; steady < steadyChecks;) {
    if (Date.now() > deadline) throw new Error(`${session.state}: ${what} within ${timeoutMs / 1000} seconds`);
    await pause(250);
    steady = (await session.ui("eval", "--js", js) as { result?: unknown }).result === true ? steady + 1 : 0;
  }
}

const drawn = (session: Session, entry: CaptureView["entry"]) => untilTrue(session, READY[entry], "the app did not finish loading", 6, 60_000);

/** Two fixtures stamp what they show with the minute it happened. Starting clear of a minute's end keeps a pair's stamps equal. */
async function clearOfMinuteEnd(now: () => number = Date.now): Promise<void> {
  const left = 60_000 - (now() % 60_000);
  if (left < 25_000) await pause(left + 500);
}

export async function capture(options: {
  view: CaptureView; slug: string; apps: CaptureApp[]; outDir: string; color: string; reducedMotion: boolean; width: number; height: number; scale: number;
}): Promise<string[]> {
  const { view, slug, outDir } = options;
  const planned = plannedShots(view.steps, options.apps.map((app) => app.state), slug);
  mkdirSync(outDir, { recursive: true });
  const launched = await Promise.allSettled(options.apps.map((app) => launchFixture(view, app)));
  const sessions = launched.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const written: string[] = [];
  try {
    const failed = launched.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    const shoot = async (session: Session, name: string) => {
      await session.ui("eval", "--js", STEADY_PAGE);
      await pause(400);
      const out = join(outDir, `${slug}.${name}.raw.png`);
      await session.ui("screenshot", "--out", out);
      written.push(out);
    };
    await Promise.all(sessions.map(async (session) => {
      const { handle } = session;
      await fixtureApi(handle.url)("PATCH", `/api/bots/${handle.botId}`, { color: options.color });
      await agentBrowser(handle.binary, sessionEnv(handle), ["set", "viewport", String(options.width), String(options.height), String(options.scale)]);
      await agentBrowser(handle.binary, sessionEnv(handle), ["set", "media", "dark", ...(options.reducedMotion ? ["reduced-motion"] : [])]);
      await drawn(session, view.entry);
    }));
    if (sessions.length > 1) await clearOfMinuteEnd();
    for (const step of view.steps) {
      const now = new Date().toISOString();
      await Promise.all(sessions.filter((session) => !step.only || step.only === session.state).map(async (session) => {
        if ("click" in step) await session.ui("click", "--name", step.click);
        else if ("type" in step) await session.ui("type", "--name", step.type.name, "--text", step.type.text);
        else if ("press" in step) await session.ui("press", "--keys", step.press);
        else if ("settle" in step) await session.ui("wait-settle", "--timeout", String(step.settle));
        else if ("waitMs" in step) await pause(step.waitMs);
        else if ("waitFor" in step) await untilTrue(session, step.waitFor, `never true: ${step.waitFor}`);
        else if ("eval" in step) await session.ui("eval", "--js", step.eval);
        else if ("reload" in step) {
          await session.ui("eval", "--js", "(location.reload(), true)");
          await pause(500);
          await drawn(session, view.entry);
        } else if ("appendRows" in step) {
          const { file, rows } = fill(step.appendRows, { botId: session.handle.botId, now, month: now.slice(0, 7) });
          const path = dataFilePath(session.handle.home, file);
          mkdirSync(dirname(path), { recursive: true });
          appendFileSync(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
        } else if ("shot" in step) await shoot(session, step.shot === true ? session.state : step.shot);
      }));
    }
    await Promise.all(sessions.filter((session) => !view.steps.some((step) => "shot" in step && (!step.only || step.only === session.state)))
      .map((session) => shoot(session, session.state)));
  } finally {
    await Promise.all(sessions.map((session) => stopFixture(session.child)));
  }
  return [...planned.values()].flat().map((file) => join(outDir, file)).filter((file) => written.includes(file));
}

function readApps(given: string[] | undefined, state: string): CaptureApp[] {
  const apps = (given ?? [ROOT]).map((value) => {
    const named = /^([a-z0-9][a-z0-9-]*)=(.+)$/.exec(value);
    return { state: named ? named[1]! : state, root: resolve(named ? named[2]! : value) };
  });
  for (const app of apps) {
    if (!existsSync(join(app.root, "scripts/control-dusk.ts"))) throw new UsageError(`--app ${app.root} is not a dusk bot checkout`);
  }
  if (new Set(apps.map((app) => app.state)).size !== apps.length) throw new UsageError("give each --app its own state, as before=DIR and after=DIR");
  return apps;
}

function readOptions(argv: string[]): Parameters<typeof capture>[0] | null {
  const { values } = parseArgs({
    args: argv,
    options: {
      view: { type: "string" }, steps: { type: "string" }, recipe: { type: "string" }, app: { type: "string", multiple: true },
      entry: { type: "string", default: "threads" }, script: { type: "string" },
      slug: { type: "string" }, state: { type: "string", default: "after" }, "out-dir": { type: "string" },
      color: { type: "string" }, width: { type: "string" }, height: { type: "string" }, scale: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return null;
  if (!WORD.test(values.state)) throw new UsageError("--state must be lowercase-with-hyphens");
  if ([values.view, values.steps, values.recipe].filter((value) => value !== undefined).length !== 1) throw new UsageError("give one of --view NAME, --steps FILE or --recipe FILE");
  const json = (file: string) => JSON.parse(readFileSync(resolve(file), "utf8")) as unknown;
  let view: CaptureView;
  let recipe: ReturnType<typeof readRecipe> | undefined;
  try {
    if (values.view !== undefined) {
      if (!Object.hasOwn(VIEWS, values.view)) throw new Error(`unknown --view ${values.view}; views: ${Object.keys(VIEWS).join(", ")}`);
      view = VIEWS[values.view]!;
    } else if (values.recipe !== undefined) {
      view = recipe = readRecipe(json(values.recipe));
    } else {
      if (!ENTRIES.includes(values.entry as CaptureView["entry"])) throw new Error(`--entry must be one of: ${ENTRIES.join(", ")}`);
      view = { entry: values.entry as CaptureView["entry"], steps: readSteps(json(values.steps as string)), ...(values.script ? { script: JSON.parse(values.script) as unknown[] } : {}) };
    }
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const slug = values.slug ?? (values.recipe === undefined ? undefined : basename(values.recipe).replace(/\.capture\.json$/, ""));
  if (!slug || !WORD.test(slug)) throw new UsageError("--slug must be lowercase-with-hyphens; a recipe is named <slug>.capture.json");
  const size = (name: "width" | "height" | "scale", fallback: number, min: number, max: number) => {
    const parsed = values[name] === undefined ? recipe?.[name] ?? fallback : Number(values[name]);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}`);
    return parsed;
  };
  const options = {
    view, slug, apps: readApps(values.app, values.state),
    outDir: resolve(values["out-dir"] ?? (values.recipe === undefined ? "qa-assets" : dirname(values.recipe))),
    color: values.color ?? recipe?.color ?? "orange", reducedMotion: recipe?.reducedMotion ?? true,
    width: size("width", 1280, 320, 3840), height: size("height", 800, 320, 2400), scale: size("scale", 2, 1, 3),
  };
  try {
    plannedShots(view.steps, options.apps.map((app) => app.state), slug);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  return options;
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
