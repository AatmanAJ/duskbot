import { isAbsolute, relative, resolve } from "node:path";

type Action =
  | { click: string }
  | { type: { name: string; text: string } }
  | { press: string }
  /** Wait until the seeded bot's turn has settled, at most this many seconds. */
  | { settle: number }
  | { waitMs: number }
  /** Wait until this expression is `true` in the page, at most 30 seconds. */
  | { waitFor: string }
  | { eval: string }
  /** Load the page again and wait for it to draw. */
  | { reload: true }
  /** Add rows to a JSON-lines file in the fixture's data directory, for what the fake engine cannot produce.
   * In `file` and in every string of a row, `{botId}`, `{now}` (the ISO time of this step) and `{month}` (`YYYY-MM`) are filled in. */
  | { appendRows: { file: string; rows: unknown[] } }
  /** Screenshot now: `true` as `<slug>.<state>.raw.png`, a word as `<slug>.<word>.raw.png`. */
  | { shot: string | true };

/** One thing done to the page before or between screenshots. With `only`, just in the capture of that state. */
export type CaptureStep = Action & { only?: string };

export const ENTRIES = ["threads", "settings", "dictation"] as const;

export interface CaptureView {
  /** A `control-dusk ui launch --entry`. */
  entry: (typeof ENTRIES)[number];
  /** A fake-engine turn, as `ui launch --script` takes it. */
  script?: unknown[];
  /** The fake engine's tool calls, as `ui launch --tool-calls` takes them. */
  toolCalls?: unknown[];
  steps: CaptureStep[];
}

/** `<slug>.capture.json`, kept beside the raw screenshots it makes. */
export interface CaptureRecipe extends CaptureView {
  /** For the reader: what the capture shows and anything in it that is staged. */
  about?: string;
  /** The seeded bot's colour, a name the app knows. */
  color?: string;
  /** `false` lets the app animate, for a view that draws wrongly with motion reduced; wait out its animations with `waitMs`. */
  reducedMotion?: boolean;
  /** The window, in points, and its pixels per point. */
  width?: number;
  height?: number;
  scale?: number;
}

export const WORD = /^[a-z0-9][a-z0-9-]*$/;

const ACTIONS = ["click", "type", "press", "settle", "waitMs", "waitFor", "eval", "reload", "appendRows", "shot"] as const;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isCount = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const VALID: Record<(typeof ACTIONS)[number], (value: unknown) => boolean> = {
  click: isText,
  type: (value) => !!value && typeof value === "object" && isText((value as { name?: unknown }).name) && typeof (value as { text?: unknown }).text === "string",
  press: isText,
  settle: (value) => isCount(value, 1, 600),
  waitMs: (value) => isCount(value, 0, 60_000),
  waitFor: isText,
  eval: isText,
  reload: (value) => value === true,
  appendRows: (value) => !!value && typeof value === "object" && isText((value as { file?: unknown }).file) && Array.isArray((value as { rows?: unknown }).rows),
  shot: (value) => value === true || (typeof value === "string" && WORD.test(value)),
};

/** The steps of a recipe or a `--steps` file, checked; throws naming the first step that is wrong. */
export function readSteps(value: unknown): CaptureStep[] {
  if (!Array.isArray(value)) throw new Error("steps must be a JSON array");
  value.forEach((step, index) => {
    const where = `step ${index + 1}`;
    if (!step || typeof step !== "object" || Array.isArray(step)) throw new Error(`${where} must be an object`);
    const { only, ...action } = step as Record<string, unknown>;
    if (only !== undefined && (typeof only !== "string" || !WORD.test(only))) throw new Error(`${where}: only must be a state, lowercase-with-hyphens`);
    const [name, ...extra] = Object.keys(action);
    if (!name || extra.length) throw new Error(`${where} must hold exactly one of: ${ACTIONS.join(", ")}`);
    if (!Object.hasOwn(VALID, name)) throw new Error(`${where}: unknown step ${name}; steps: ${ACTIONS.join(", ")}`);
    if (!VALID[name as keyof typeof VALID](action[name])) throw new Error(`${where}: ${name} has the wrong value`);
  });
  return value as CaptureStep[];
}

/** A `<slug>.capture.json`, checked. */
export function readRecipe(value: unknown): CaptureRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("a recipe must be a JSON object");
  const { about, entry = "threads", script, toolCalls, color, reducedMotion, width, height, scale, steps, ...unknown } = value as Record<string, unknown>;
  const extra = Object.keys(unknown);
  if (extra.length) throw new Error(`unknown recipe field ${extra.join(", ")}`);
  if (about !== undefined && typeof about !== "string") throw new Error("about must be text");
  if (!ENTRIES.includes(entry as CaptureView["entry"])) throw new Error(`entry must be one of: ${ENTRIES.join(", ")}`);
  if (script !== undefined && !Array.isArray(script)) throw new Error("script must be a JSON array");
  if (toolCalls !== undefined && !Array.isArray(toolCalls)) throw new Error("toolCalls must be a JSON array");
  if (color !== undefined && !isText(color)) throw new Error("color must be a colour's name");
  if (reducedMotion !== undefined && typeof reducedMotion !== "boolean") throw new Error("reducedMotion must be true or false");
  if (width !== undefined && !isCount(width, 320, 3840)) throw new Error("width must be a whole number from 320 to 3840");
  if (height !== undefined && !isCount(height, 320, 2400)) throw new Error("height must be a whole number from 320 to 2400");
  if (scale !== undefined && !isCount(scale, 1, 3)) throw new Error("scale must be a whole number from 1 to 3");
  return {
    entry: entry as CaptureView["entry"], steps: readSteps(steps),
    ...(about === undefined ? {} : { about }), ...(script ? { script } : {}), ...(toolCalls ? { toolCalls } : {}),
    ...(color === undefined ? {} : { color }), ...(reducedMotion === undefined ? {} : { reducedMotion }), ...(width === undefined ? {} : { width: width as number }),
    ...(height === undefined ? {} : { height: height as number }), ...(scale === undefined ? {} : { scale: scale as number }),
  };
}

/** Every `{name}` in every string of `value` replaced by `values[name]`; other braces are left alone. */
export function fill<T>(value: T, values: Record<string, string>): T {
  if (typeof value === "string") return value.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? values[name]! : whole)) as T;
  if (Array.isArray(value)) return value.map((item) => fill(item, values)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, values)])) as T;
  return value;
}

/** Where `file` lies inside the fixture's data directory. Security: a recipe never writes outside it. */
export function dataFilePath(dataDir: string, file: string): string {
  const path = resolve(dataDir, file);
  const inside = relative(resolve(dataDir), path);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) throw new Error(`appendRows writes only inside the fixture's data directory: ${file}`);
  return path;
}

/** The file each state writes at each step, and a refusal when two states captured together would write the same one. */
export function plannedShots(steps: CaptureStep[], states: string[], slug: string): Map<string, string[]> {
  const shots = new Map<string, string[]>();
  for (const state of states) {
    const names = steps.filter((step) => "shot" in step && (!step.only || step.only === state))
      .map((step) => ((step as { shot: string | true }).shot === true ? state : (step as { shot: string }).shot));
    shots.set(state, (names.length ? names : [state]).map((name) => `${slug}.${name}.raw.png`));
  }
  const seen = new Map<string, string>();
  for (const [state, files] of shots) {
    for (const file of files) {
      const other = seen.get(file);
      if (other !== undefined) throw new Error(`${other === state ? `${state} writes` : `${other} and ${state} both write`} ${file}; give that shot an "only" or another name`);
      seen.set(file, state);
    }
  }
  return shots;
}
