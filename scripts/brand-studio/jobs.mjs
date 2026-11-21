import { join } from "node:path";

const RAW_NAME = /^(?<slug>[a-z0-9][a-z0-9-]*)\.(?<state>[a-z0-9][a-z0-9-]*)\.raw\.png$/;
const FRAME_STATE = /^f(?<order>\d+)(?:-(?<label>[a-z0-9-]+))?$/;

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
 * The framed files a folder of raw captures yields:
 * - `<slug>.<state>.raw.png` gives `<slug>.<state>.png`;
 * - a slug with both `before` and `after` also gives `<slug>.before-after.png`;
 * - a slug's `f<NN>[-<label>]` states, in number order, give `<slug>.gif`.
 */
export function planReframe(dir, names) {
  const slugs = new Map();
  for (const name of [...names].sort()) {
    const raw = parseRawName(name);
    if (!raw) continue;
    const entry = slugs.get(raw.slug) ?? { stills: new Map(), frames: [] };
    slugs.set(raw.slug, entry);
    if (raw.frame) entry.frames.push({ ...raw.frame, file: join(dir, name) });
    else entry.stills.set(raw.state, join(dir, name));
  }
  const jobs = [];
  for (const [slug, { stills, frames }] of slugs) {
    for (const [state, file] of stills) {
      jobs.push({ kind: "still", shots: [file], labels: [], out: join(dir, `${slug}.${state}.png`) });
    }
    if (stills.has("before") && stills.has("after")) {
      jobs.push({ kind: "still", shots: [stills.get("before"), stills.get("after")], labels: ["before", "after"], out: join(dir, `${slug}.before-after.png`) });
    }
    if (frames.length >= 2) {
      frames.sort((a, b) => a.order - b.order);
      const labels = frames.some((frame) => frame.label) ? frames.map((frame) => frame.label) : [];
      jobs.push({ kind: "animation", shots: frames.map((frame) => frame.file), labels, out: join(dir, `${slug}.gif`) });
    }
  }
  return jobs;
}
