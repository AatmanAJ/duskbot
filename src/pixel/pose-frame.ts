import { stillFrame, type PixelState } from "./engine";

export type PoseExtra = "dots1" | "dots2" | "dots3" | "spark1" | "spark2" | "spark3";

/** One drawn pose of the working mascot, every amount in whole sprite pixels (rot in degrees, narrow as a width
 * fraction), so each frame is a crisp grid. */
export type MascotPose = {
  face: PixelState;
  flip: boolean;
  /** -1 or 1 turns the face's sideways look that way (0 keeps it) */
  look: number;
  blink: boolean;
  eyesOff: boolean;
  dx: number;
  dy: number;
  sq: number;
  lean: number;
  rot: number;
  narrow: number;
  extra: PoseExtra | null;
};

export const REST_POSE: MascotPose = { face: "idle", flip: false, look: 0, blink: false, eyesOff: false, dx: 0, dy: 0, sq: 0, lean: 0, rot: 0, narrow: 1, extra: null };

/** Svg path data for a pose in the body's own G by G box; parts may reach outside it. */
export type PoseArt = { G: number; body: string; eyes: string; extra: string };

const BODY = 1, EYE = 2, EXTRA = 3;

type Base = { W: number; H: number; G: number; px: number; pt: number; paint: Uint8Array; top: number; left: number; right: number; eyeAxis: number; side: number };
const bases = new Map<string, Base>();

function bounds(paint: Uint8Array, W: number, H: number) {
  let top = H, left = W, right = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (paint[y * W + x]) { if (y < top) top = y; if (x < left) left = x; if (x > right) right = x; }
  return { top, left, right };
}

function eyeMiddle(paint: Uint8Array, W: number): number {
  let lo = W, hi = -1;
  for (let i = 0; i < paint.length; i++) if (paint[i] === EYE) { const x = i % W; if (x < lo) lo = x; if (x > hi) hi = x; }
  return hi >= 0 ? (lo + hi) / 2 : 0;
}

function baseOf(body: string, face: PixelState): Base {
  const id = `${body}|${face}`;
  const known = bases.get(id);
  if (known) return known;
  const f = stillFrame(body, { scale: 1, state: face });
  const rest = stillFrame(body, { scale: 1 });
  let lo = f.W, hi = -1;
  for (let i = 0; i < rest.paint.length; i++) if (rest.paint[i] === EYE) { const x = i % rest.W; if (x < lo) lo = x; if (x > hi) hi = x; }
  const eyeAxis = hi >= 0 ? lo + hi : f.W - 1;
  const base = { W: f.W, H: f.H, G: f.G, px: f.px, pt: f.pt, paint: f.paint, ...bounds(rest.paint, rest.W, rest.H), eyeAxis, side: Math.sign(eyeMiddle(f.paint, f.W) * 2 - eyeAxis) };
  bases.set(id, base);
  return base;
}

function eyed(base: Base, pose: MascotPose, body: string): Uint8Array {
  const { W, paint } = base;
  const out = new Uint8Array(paint.length);
  for (let i = 0; i < paint.length; i++) out[i] = paint[i] ? BODY : 0;
  if (pose.eyesOff) return out;
  const source = pose.blink ? baseOf(body, "sleeping").paint : paint;
  const flip = pose.look && base.side ? base.side !== pose.look : pose.flip;
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== EYE) continue;
    const x = i % W, y = (i / W) | 0, mx = flip && !pose.blink ? base.eyeAxis - x : x;
    if (mx >= 0 && mx < W && out[y * W + mx]) out[y * W + mx] = EYE;
  }
  return out;
}

/** Resample of the body for a pose: shift, lean (top half by `lean` pixels), squash about the feet and rotation about
 * the body's middle, sampled at pixel centres so the grid stays whole; a turn off the right angles takes the majority of
 * nine samples per pixel so its edges stay clean. */
function posed(base: Base, src: Uint8Array, pose: MascotPose): Uint8Array {
  const { W, H, G, px, pt } = base, out = new Uint8Array(W * H);
  const footX = px + G / 2, footY = pt + G, midY = pt + G / 2;
  const sy = (G - pose.sq) / G, sx = ((G + pose.sq * 0.75) / G) * pose.narrow;
  const a = (-pose.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const sample = (ox: number, oy: number): number => {
    let x = ox - pose.dx, y = oy + pose.dy;
    x -= Math.trunc((pose.lean * (footY - y)) / (G * 0.55));
    x = footX + (x - footX) / sx;
    y = footY - (footY - y) / sy;
    if (pose.rot) {
      const qx = x - footX, qy = y - midY;
      x = footX + qx * c - qy * s;
      y = midY + qx * s + qy * c;
    }
    const sxi = Math.floor(x), syi = Math.floor(y);
    return sxi >= 0 && syi >= 0 && sxi < W && syi < H ? src[syi * W + sxi]! : 0;
  };
  const smooth = pose.rot % 90 !== 0;
  for (let oy = 0; oy < H; oy++) for (let ox = 0; ox < W; ox++) {
    if (!smooth) { out[oy * W + ox] = sample(ox + 0.5, oy + 0.5); continue; }
    let filled = 0, eye = 0;
    for (const j of [1 / 6, 0.5, 5 / 6]) for (const i of [1 / 6, 0.5, 5 / 6]) { const v = sample(ox + i, oy + j); if (v) filled++; if (v === EYE) eye++; }
    out[oy * W + ox] = filled >= 5 ? (eye >= 3 ? EYE : BODY) : 0;
  }
  return out;
}

const SPARK = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const;

function extras(base: Base, extra: PoseExtra): Array<readonly [number, number]> {
  const { top, left, right } = base, mid = Math.round((left + right) / 2);
  if (extra.startsWith("dots")) return ([-2, 0, 2] as const).slice(0, Number(extra.slice(4))).map((i) => [mid + i, top - 2] as const);
  const arm = extra === "spark2" ? SPARK : SPARK.slice(0, 1);
  const at = (cx: number, cy: number) => arm.map(([i, j]) => [cx + i, cy + j] as const);
  return extra === "spark3" ? [[left - 2, top], [right + 2, top + 2]] : [...at(left - 2, top), ...at(right + 2, top + 2)];
}

function runs(paint: Uint8Array, W: number, H: number, v: number, ox: number, oy: number): string {
  let d = "";
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (paint[y * W + x] !== v) continue;
    let e = x;
    while (e + 1 < W && paint[y * W + e + 1] === v) e++;
    d += `M${x - ox} ${y - oy}h${e - x + 1}v1h${-(e - x + 1)}z`;
    x = e;
  }
  return d;
}

export const poseKey = (p: MascotPose): string => `${p.face}|${+p.flip}${p.look}${+p.blink}${+p.eyesOff}|${p.dx},${p.dy},${p.sq},${p.lean},${p.rot},${p.narrow}|${p.extra ?? ""}`;

const arts = new Map<string, PoseArt>();

export function poseArt(body: string, pose: MascotPose): PoseArt {
  const id = `${body}|${poseKey(pose)}`;
  const known = arts.get(id);
  if (known) return known;
  const base = baseOf(body, pose.face);
  const { W, H, G, px, pt } = base;
  const paint = posed(base, eyed(base, pose, body), pose);
  if (pose.extra) for (const [x, y] of extras(base, pose.extra)) if (x >= 0 && y >= 0 && x < W && y < H && !paint[y * W + x]) paint[y * W + x] = EXTRA;
  const art = { G, body: runs(paint, W, H, BODY, px, pt) + runs(paint, W, H, EYE, px, pt), eyes: runs(paint, W, H, EYE, px, pt), extra: runs(paint, W, H, EXTRA, px, pt) };
  if (arts.size > 2000) arts.clear();
  arts.set(id, art);
  return art;
}
