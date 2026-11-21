import { join } from "node:path";

import { ARRANGEMENTS, parseCrop } from "./layout.mjs";

const RAW_NAME = /^(?<slug>[a-z0-9][a-z0-9-]*)\.(?<state>[a-z0-9][a-z0-9-]*)\.raw\.png$/;
const FRAME_STATE = /^f(?<order>\d+)(?:-(?<label>[a-z0-9-]+))?$/;
const PR_NAME = /^(?<slug>pr-\d+)-(?<state>before|after)(?:-(?<variant>[a-z0-9-]+))?\.png$/;
const PR_FRAMED_VARIANT = /(?:^|-)framed$/;
const PR_PAIR_VARIANT = /^after(?:-|$)/;

/** The file a folder's framing options are read from. */
export const OPTIONS_FILE = "frame.json";

/** `<slug>.<state>.raw.png` split into its parts; null for any other file name. */
export function parseRawName(name) {
  const match = RAW_NAME.exec(name);
  if (!match) return null;
  const { slug, state } = match.groups;
  const frame = FRAME_STATE.exec(state);
  return frame
    ? { slug, state, frame: { order: Number(frame.groups.order), label: frame.groups.label?.replaceAll("-", " ") ?? "" } }
    : { slug, state, frame: null };
}

/**
 * `pr-<n>-before.png`, `pr-<n>-after.png` or either with a `-<variant>` (a
 * second case of the same pull request) split into its parts; null for any
 * other file name, the framed `pr-<n>-…-framed.png` and
 * `pr-<n>-before-after….png` this naming yields among them.
 */
export function parsePrName(name) {
  const match = PR_NAME.exec(name);
  if (!match) return null;
  const { slug, state, variant = "" } = match.groups;
  if (PR_FRAMED_VARIANT.test(variant) || (state === "before" && PR_PAIR_VARIANT.test(variant))) return null;
  return { slug, state, variant };
}

function readRaw(name) {
  const raw = parseRawName(name);
  if (raw) {
    return { group: `${raw.slug}.`, state: raw.state, frame: raw.frame, still: `${raw.slug}.${raw.state}.png`, pair: `${raw.slug}.before-after.png`, gif: `${raw.slug}.gif` };
  }
  const pr = parsePrName(name);
  if (!pr) return null;
  const tail = pr.variant ? `-${pr.variant}` : "";
  return { group: `${pr.slug}-${pr.variant}`, state: pr.state, frame: null, still: `${pr.slug}-${pr.state}${tail}-framed.png`, pair: `${pr.slug}-before-after${tail}.png`, gif: null };
}

function framing(out, shotCount, given = {}) {
  const unknown = Object.keys(given).filter((key) => !["shots", "crop", "arrange", "labels", "frames", "hold", "fade"].includes(key));
  if (unknown.length) throw new Error(`${OPTIONS_FILE}: ${out} has unknown option ${unknown.join(", ")}`);
  const texts = given.crop === undefined ? [] : [given.crop].flat();
  if (texts.length > 1 && texts.length !== shotCount) throw new Error(`${OPTIONS_FILE}: ${out} needs one crop, or one per shot (${shotCount})`);
  const crops = Array.from({ length: shotCount }, (_, index) => {
    const text = texts.length > 1 ? texts[index] : texts[0];
    if (text === undefined || text === null) return null;
    const crop = parseCrop(text);
    if (!crop) throw new Error(`${OPTIONS_FILE}: ${out} has a crop that is not "x,y,width,height": ${text}`);
    return crop;
  });
  if (given.arrange !== undefined && !ARRANGEMENTS.includes(given.arrange)) {
    throw new Error(`${OPTIONS_FILE}: ${out} has an arrange that is not one of ${ARRANGEMENTS.join(", ")}`);
  }
  if (given.labels !== undefined && (!Array.isArray(given.labels) || given.labels.length !== shotCount)) {
    throw new Error(`${OPTIONS_FILE}: ${out} needs one label per shot (${shotCount})`);
  }
  if (given.shots !== undefined && given.shots.length !== shotCount) throw new Error(`${OPTIONS_FILE}: ${out} is made by the naming convention and takes no shots`);
  return { crops, ...(given.arrange ? { arrange: given.arrange } : {}), ...(given.labels ? { labels: given.labels.map(String) } : {}) };
}

function timing(out, given = {}) {
  const read = (key, min) => {
    if (given[key] === undefined) return {};
    if (!Number.isFinite(given[key]) || given[key] < min) throw new Error(`${OPTIONS_FILE}: ${out} needs a ${key} of at least ${min} milliseconds`);
    return { [`${key}Ms`]: given[key] };
  };
  return { ...read("hold", 20), ...read("fade", 0) };
}

function chosenFrames(out, frames, wanted) {
  if (wanted === undefined) return frames;
  const byName = new Map(frames.map((frame) => [frame.name, frame]));
  const missing = Array.isArray(wanted) ? wanted.filter((name) => !byName.has(name)) : [];
  if (!Array.isArray(wanted) || wanted.length < 2 || missing.length) {
    throw new Error(`${OPTIONS_FILE}: ${out} needs frames that list at least two of its numbered raw files${missing.length ? `, which do not include ${missing.join(", ")}` : ""}`);
  }
  return wanted.map((name) => byName.get(name));
}

/**
 * The framed files a folder of raw captures yields:
 * - `<slug>.<state>.raw.png` gives `<slug>.<state>.png`;
 * - a slug with both `before` and `after` also gives `<slug>.before-after.png`;
 * - a slug's `f<NN>[-<label>]` states, in number order, give `<slug>.gif`;
 * - `pr-<n>-<before|after>[-<variant>].png` gives `pr-<n>-<state>[-<variant>]-framed.png`,
 *   and a before with its after `pr-<n>-before-after[-<variant>].png`.
 *
 * `options` is the folder's `frame.json`: framed file name to
 * `{ crop, arrange, labels }` (a GIF also takes `frames`, the numbered raw
 * files it shows in the order given, and `hold` and `fade` in milliseconds),
 * where `crop` is one "x,y,width,height" in
 * points for every shot of that file or a list with one per shot (null leaves
 * a shot whole). An entry with `shots`, a list of raw files in the folder, is
 * one more still made from them, such as a second, closer crop of a pair.
 */
export function planReframe(dir, names, options = {}) {
  const groups = new Map();
  for (const name of [...names].sort()) {
    const raw = readRaw(name);
    if (!raw) continue;
    const entry = groups.get(raw.group) ?? { stills: new Map(), frames: [], pair: raw.pair, gif: raw.gif };
    groups.set(raw.group, entry);
    if (raw.frame) entry.frames.push({ ...raw.frame, name, file: join(dir, name) });
    else entry.stills.set(raw.state, { file: join(dir, name), out: raw.still });
  }
  const jobs = [];
  const add = (kind, out, shots, labels) => {
    const given = options[out] ?? {};
    const animated = kind === "animation";
    const misplaced = ["frames", "hold", "fade"].filter((key) => !animated && given[key] !== undefined);
    if (misplaced.length) throw new Error(`${OPTIONS_FILE}: ${out} is a still and takes no ${misplaced.join(", ")}`);
    const { frames: _frames, hold: _hold, fade: _fade, ...shared } = given;
    jobs.push({ kind, shots, labels, out: join(dir, out), ...framing(out, shots.length, shared), ...(animated ? timing(out, given) : {}) });
  };
  for (const { stills, frames, pair, gif } of groups.values()) {
    for (const still of stills.values()) add("still", still.out, [still.file], []);
    if (stills.has("before") && stills.has("after")) {
      add("still", pair, [stills.get("before").file, stills.get("after").file], ["before", "after"]);
    }
    if (frames.length >= 2) {
      frames.sort((a, b) => a.order - b.order);
      const shown = chosenFrames(gif, frames, options[gif]?.frames);
      add("animation", gif, shown.map((frame) => frame.file), shown.some((frame) => frame.label) ? shown.map((frame) => frame.label) : []);
    }
  }
  const made = new Set(jobs.map((job) => job.out));
  const extra = Object.keys(options).filter((out) => !made.has(join(dir, out)));
  const stray = extra.filter((out) => !Array.isArray(options[out]?.shots) || !options[out].shots.length);
  if (stray.length) throw new Error(`${OPTIONS_FILE} names files this folder does not yield: ${stray.join(", ")}`);
  for (const out of extra) {
    const { shots } = options[out];
    const missing = shots.filter((shot) => !names.includes(shot));
    if (!out.endsWith(".png") || missing.length) throw new Error(`${OPTIONS_FILE}: ${out} must be a .png made from raw files in the folder${missing.length ? `, which has no ${missing.join(", ")}` : ""}`);
    add("still", out, shots.map((shot) => join(dir, shot)), []);
  }
  return jobs;
}
