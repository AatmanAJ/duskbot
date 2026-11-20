import type { PixelState } from "@/pixel/engine";
import type { WorkingMood } from "./working-mood";

export type MascotLook = "card" | "voxel";
export type MascotPace = "calm" | "lively";
export type MascotVariant = `${MascotLook}-${MascotPace}`;
export type MascotMotionPick = "current" | MascotVariant;

/** How the chat's working mascot moves: "current" keeps the shipped CSS loops; the others move it in 3D, drawn as a
 * flat card or as voxels, at a calm or a lively pace. */
export const MASCOT_MOTION: MascotMotionPick = "current";

/** No two delights (a roll, a barrel roll, a spin, a flip) start closer than this. */
export const DELIGHT_GAP_MS = 8000;
/** A change of step glides from wherever the mascot is to the new step's motion over this long. */
export const BLEND_MS = 380;

/** Where the mascot is at one moment: y in box heights (negative is up), squash as x and y scale about its feet,
 * rotations in degrees about its middle. */
export type MascotMotion = { y: number; sx: number; sy: number; rx: number; ry: number; rz: number; face: PixelState; look: number; blink: boolean };

type Delight = "roll" | "barrel" | "spin" | "flip";
type Pace = { hop: number; sway: number; period: number; every: readonly [number, number]; delights: readonly Delight[] };

const PACES: Record<MascotPace, Pace> = {
  calm: { hop: 0.1, sway: 1, period: 0.68, every: [10_000, 12_000], delights: ["roll", "spin", "barrel"] },
  lively: { hop: 0.17, sway: 1.45, period: 0.54, every: [8_000, 10_000], delights: ["roll", "barrel", "spin", "flip"] },
};

const DELIGHT_MS: Record<Delight, number> = { roll: 950, barrel: 900, spin: 820, flip: 1050 };
export const delightMs = (kind: Delight): number => DELIGHT_MS[kind];

type Faced = { face: PixelState; ms: number; once?: boolean };
const FACES: Record<WorkingMood, readonly Faced[]> = {
  thinking: [{ face: "thinking", ms: 5600 }, { face: "confused", ms: 2200 }],
  reading: [{ face: "working", ms: 3000 }],
  writing: [{ face: "working", ms: 3000 }],
  replying: [{ face: "happy", ms: 2000, once: true }, { face: "working", ms: 3000 }],
  running: [{ face: "working", ms: 3200 }, { face: "listening", ms: 2000 }],
  searching: [{ face: "searching", ms: 2800 }],
  browsing: [{ face: "listening", ms: 2800 }, { face: "working", ms: 2400 }],
  waiting: [{ face: "idle", ms: 3000 }, { face: "confused", ms: 2000 }],
  error: [{ face: "sad", ms: 4000 }],
  done: [{ face: "happy", ms: 4000 }],
};

const DELIGHT_MOODS = new Set<WorkingMood>(["thinking", "searching", "browsing", "running", "reading", "writing"]);
const LOOKING_MOODS = new Set<WorkingMood>(["thinking", "searching", "reading"]);
const SPIN_HOP_MOODS = new Set<WorkingMood>(["replying", "done"]);
const SPIN_HOP_MS = 1000;

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (k: number, a: number, b: number) => clamp01((k - a) / (b - a));
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const easeInOutSine = (k: number) => (1 - Math.cos(Math.PI * k)) / 2;
const arc = (k: number) => 4 * k * (1 - k);
/** -1..1 that holds at each side and glides between them, one full cycle per `period` */
const sideToSide = (t: number, period: number) => Math.max(-1, Math.min(1, Math.sin((TAU * t) / period) * 1.6));
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

const REST: MascotMotion = { y: 0, sx: 1, sy: 1, rx: 0, ry: 0, rz: 0, face: "idle", look: 0, blink: false };

function breathe(m: MascotMotion, t: number, amount = 1): void {
  const b = Math.sin((TAU * t) / 2.6) * amount;
  m.sy += 0.025 * b;
  m.sx -= 0.015 * b;
}

function hopCycle(m: MascotMotion, t: number, period: number, height: number): void {
  const u = (t / period) % 1;
  if (u < 0.6) {
    const a = u / 0.6;
    m.y -= height * arc(a);
    m.sy += 0.07 * Math.sin(Math.PI * a) * (height / 0.15);
    m.sx -= 0.04 * Math.sin(Math.PI * a) * (height / 0.15);
  } else {
    const s = Math.sin((Math.PI * (u - 0.6)) / 0.4) * (height / 0.15);
    m.sy -= 0.13 * s;
    m.sx += 0.09 * s;
  }
}

/** A one-shot jump that turns `deg` about `axis` in the air: crouch, launch, turn, land with a squash. */
function jumpTurn(m: MascotMotion, k: number, axis: "rx" | "ry" | "rz", deg: number, height: number): void {
  const crouch = span(k, 0, 0.14), air = span(k, 0.14, 0.84), land = span(k, 0.84, 1);
  if (k < 0.14) { m.sy -= 0.14 * Math.sin(Math.PI * crouch); m.sx += 0.08 * Math.sin(Math.PI * crouch); }
  else if (k < 0.84) { m.y -= height * arc(air); m.sy += 0.08 * Math.sin(Math.PI * air); m.sx -= 0.05 * Math.sin(Math.PI * air); }
  else { m.sy -= 0.17 * Math.sin(Math.PI * land); m.sx += 0.11 * Math.sin(Math.PI * land); }
  m[axis] += deg * easeInOutSine(air);
}

const DELIGHT_MOVES: Record<Delight, (m: MascotMotion, k: number, p: Pace) => void> = {
  roll: (m, k, p) => jumpTurn(m, k, "rx", -360, p.hop * 1.5),
  barrel: (m, k, p) => jumpTurn(m, k, "rz", 360, p.hop * 1.4),
  spin: (m, k, p) => jumpTurn(m, k, "ry", 360, p.hop * 1.1),
  flip: (m, k, p) => jumpTurn(m, k, "rx", 360, p.hop * 2),
};

function moodMotion(mood: WorkingMood, t: number, p: Pace, m: MascotMotion): void {
  const s = p.sway;
  switch (mood) {
    case "thinking":
      breathe(m, t);
      m.ry += 26 * s * sideToSide(t, 5.2);
      m.rx += -12 + 3 * Math.sin((TAU * t) / 3.4);
      break;
    case "searching":
      breathe(m, t, 0.6);
      m.ry += 36 * s * sideToSide(t, 3.4);
      m.rz += -3 * sideToSide(t, 3.4);
      break;
    case "reading":
      breathe(m, t, 0.6);
      m.ry += 14 * s * Math.sin((TAU * t) / 2.8);
      m.rx += 8;
      break;
    case "browsing":
    case "running":
      hopCycle(m, t, p.period, p.hop);
      m.ry += 7 * s * Math.sin((TAU * t) / (p.period * 4));
      m.rx += 6;
      break;
    case "writing":
    case "replying":
      hopCycle(m, t, p.period * 0.78, p.hop * 0.6);
      m.rz += 4 * s * Math.sin((TAU * t) / (p.period * 1.56));
      break;
    case "waiting":
      breathe(m, t);
      m.ry += 10 * s * Math.sin((TAU * t) / 6);
      break;
    case "done":
      breathe(m, t);
      m.ry += 8 * s * Math.sin((TAU * t) / 4.4);
      break;
    case "error":
      m.sy -= 0.09 - 0.012 * Math.sin((TAU * t) / 3.8);
      m.sx += 0.05;
      m.rx += 10;
      m.rz += -7 + 2.5 * Math.sin((TAU * t) / 4.6);
      break;
  }
}

function stepAt<T extends { ms: number }>(steps: readonly T[], t: number): T {
  let left = t;
  for (const step of steps) { if (left < step.ms) return step; left -= step.ms; }
  return steps[steps.length - 1]!;
}

function faceAt(mood: WorkingMood, ms: number): PixelState {
  const all = FACES[mood], once = all.filter((f) => f.once), loop = all.filter((f) => !f.once);
  const head = once.reduce((sum, f) => sum + f.ms, 0), cycle = loop.reduce((sum, f) => sum + f.ms, 0);
  return (ms < head ? stepAt(once, ms) : stepAt(loop, (ms - head) % cycle)).face;
}

function rngOf(seed: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 16777619);
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const REDUCED: Partial<Record<WorkingMood, Partial<MascotMotion>>> = { error: { sy: 0.92, sx: 1.04, rz: -6 }, thinking: { rx: -8 } };

/** One mascot's motion as a function of time: feed it the mood as it changes and ask where it is at each moment, times
 * never going back. A change of mood glides over BLEND_MS from wherever it was, even mid-roll; delights start at least
 * DELIGHT_GAP_MS apart, the first no sooner than that, never the same kind twice running and never while it waits,
 * fails or is done. Under reduced motion it holds one still pose per mood. */
export class MascotDirector {
  readonly variant: MascotVariant;
  readonly reducedMotion: boolean;
  private readonly pace: Pace;
  private readonly rng: () => number;
  private readonly blinkEvery: number;
  private mood: WorkingMood = "thinking";
  private moodAt: number;
  private from: { at: number; gap: Omit<MascotMotion, "face" | "look" | "blink"> } | null = null;
  private nextDelight: number;
  private delight: { kind: Delight; at: number } | null = null;
  private lastKind: Delight | null = null;
  /** every delight played, for tests and the lab */
  readonly played: Array<{ kind: Delight; at: number }> = [];

  constructor({ variant, seed = "", reduced = false, at = 0 }: { variant: MascotVariant; seed?: string; reduced?: boolean; at?: number }) {
    this.variant = variant;
    this.reducedMotion = reduced;
    this.pace = PACES[variant.endsWith("lively") ? "lively" : "calm"];
    this.rng = rngOf(`${variant}|${seed}`);
    this.blinkEvery = 3400 + Math.floor(this.rng() * 1400);
    this.moodAt = at;
    this.nextDelight = at + this.gap();
  }

  private gap(): number {
    const [lo, hi] = this.pace.every;
    return Math.max(DELIGHT_GAP_MS, lo + this.rng() * (hi - lo));
  }

  setMood(mood: WorkingMood, at: number): void {
    if (mood === this.mood) return;
    const was = this.reducedMotion ? null : this.motion(at);
    this.mood = mood;
    this.moodAt = at;
    if (this.delight && (!DELIGHT_MOODS.has(mood) || SPIN_HOP_MOODS.has(mood))) this.delight = null;
    if (!was) return;
    const next = this.live(at);
    this.from = { at, gap: { y: was.y - next.y, sx: was.sx - next.sx, sy: was.sy - next.sy, rx: wrap(was.rx - next.rx), ry: wrap(was.ry - next.ry), rz: wrap(was.rz - next.rz) } };
  }

  private live(at: number): MascotMotion {
    const mood = this.mood, ms = Math.max(0, at - this.moodAt), t = ms / 1000;
    const m: MascotMotion = { ...REST, face: faceAt(mood, ms) };
    if (this.delight && at - this.delight.at >= DELIGHT_MS[this.delight.kind]) this.delight = null;
    if (!this.delight && at >= this.nextDelight && DELIGHT_MOODS.has(mood)) {
      const pool = this.pace.delights.filter((kind) => kind !== this.lastKind);
      const kind = pool[Math.floor(this.rng() * pool.length)]!;
      this.delight = { kind, at };
      this.lastKind = kind;
      this.played.push({ kind, at });
      this.nextDelight = at + this.gap();
    }
    moodMotion(mood, t, this.pace, m);
    if (SPIN_HOP_MOODS.has(mood) && ms < SPIN_HOP_MS) jumpTurn(m, ms / SPIN_HOP_MS, "ry", 360, this.pace.hop * 1.6);
    if (this.delight) {
      DELIGHT_MOVES[this.delight.kind](m, (at - this.delight.at) / DELIGHT_MS[this.delight.kind], this.pace);
      m.face = "happy";
    }
    m.look = LOOKING_MOODS.has(mood) && Math.abs(m.ry) > 8 ? Math.sign(m.ry) : 0;
    m.blink = !this.delight && m.face !== "happy" && m.face !== "sad" && at % this.blinkEvery < (mood === "thinking" ? 200 : 120);
    return m;
  }

  motion(at: number): MascotMotion {
    if (this.reducedMotion) {
      const face = FACES[this.mood].find((f) => !f.once)!.face;
      return { ...REST, face, ...REDUCED[this.mood] };
    }
    const now = this.live(at);
    const from = this.from;
    if (!from || at - from.at >= BLEND_MS) { this.from = null; return now; }
    const left = 1 - easeInOut(clamp01((at - from.at) / BLEND_MS)), gap = from.gap;
    return { ...now, y: now.y + gap.y * left, sx: now.sx + gap.sx * left, sy: now.sy + gap.sy * left, rx: now.rx + gap.rx * left, ry: now.ry + gap.ry * left, rz: now.rz + gap.rz * left };
  }
}
