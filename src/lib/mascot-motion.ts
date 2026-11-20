import { REST_POSE, type MascotPose, type PoseExtra } from "@/pixel/pose-frame";
import type { PixelState } from "@/pixel/engine";
import type { WorkingMood } from "./working-mood";

export type MascotMotionPick = "current" | "a" | "b" | "c";
export type MascotVariant = Exclude<MascotMotionPick, "current">;

/** How the chat's working mascot moves: "current" keeps the shipped CSS loops, a/b/c are the lab's frame poses. */
export const MASCOT_MOTION: MascotMotionPick = "current";

/** No two delights (a roll, a flip, a twirl, a jump) start closer than this. */
export const DELIGHT_GAP_MS = 8000;

type Step = Partial<Omit<MascotPose, "face">> & { ms: number; face?: PixelState };
type Faced = { face: PixelState; ms: number; once?: boolean };
type Delight = "roll" | "flip" | "twirl" | "jump";

type Plan = {
  loops: Partial<Record<WorkingMood, readonly Step[]>>;
  intros: Partial<Record<WorkingMood, readonly Step[]>>;
  /** gap between delights, [min, max] ms; null never plays one */
  delightEvery: readonly [number, number] | null;
  delights: readonly Delight[];
};

const hop = (h: number, face?: PixelState): Step[] => {
  const up = Array.from({ length: h }, (_, i) => ({ dy: i + 1, sq: i === 0 ? -1 : 0, ms: 50, face }));
  return [{ sq: 1, ms: 80, face }, ...up, { dy: h, ms: 70 + h * 15, face }, ...up.slice(0, -1).reverse(), { sq: 1, ms: 90, face }];
};
const sparkled = (steps: Step[], from: number): Step[] => steps.map((step, i) => (i >= from && i < from + 3 ? { ...step, extra: (["spark1", "spark2", "spark3"] as const)[i - from] } : step));
const typing = (ms: number, h: number, sway: boolean): Step[] => [
  { dy: h, sq: -1, lean: sway ? -1 : 0, ms: ms * 0.25 }, { sq: 1, ms: ms * 0.2 }, { ms: ms * 0.55 },
  ...(sway ? [{ dy: h, sq: -1, lean: 1, ms: ms * 0.25 }, { sq: 1, ms: ms * 0.2 }, { ms: ms * 0.55 }] : []),
];
const peek = (d: number, rise: boolean): Step[] => [
  { dx: -d, lean: -1, look: -1, sq: rise ? -1 : 0, ms: 1100 }, { look: -1, ms: 300 }, { dx: d, lean: 1, look: 1, sq: rise ? -1 : 0, ms: 1100 }, { look: 1, ms: 300 },
];
const taps = (h: number, count: number, rest: number): Step[] => [...Array.from({ length: count }, () => [{ dy: h, ms: 110 }, { sq: 1, ms: 80 }, { ms: 70 }]).flat(), { ms: rest }];
const droop = (shake: boolean): Step[] => [
  ...(shake ? [{ dx: -1, ms: 60 }, { dx: 1, ms: 60 }, { dx: -1, ms: 60 }] : []),
  { sq: 1, ms: 160 }, { sq: 2, lean: -1, ms: 220 }, { sq: 1, lean: -1, ms: 10 },
];

const PLANS: Record<MascotVariant, Plan> = {
  a: {
    loops: {
      thinking: [{ lean: 1, ms: 1300 }, { lean: 1, sq: 1, ms: 450 }, { lean: 1, ms: 1050 }, { lean: -1, ms: 1300 }, { lean: -1, sq: 1, ms: 450 }, { lean: -1, ms: 1050 }],
      searching: peek(1, false),
      browsing: taps(1, 1, 820),
      running: taps(1, 1, 820),
      reading: [{ lean: -1, ms: 1400 }, { ms: 200 }, { lean: 1, ms: 1400 }, { ms: 200 }],
      writing: typing(480, 1, false),
      replying: typing(480, 1, false),
      waiting: taps(1, 2, 1500),
      error: [{ sq: 1, lean: -1, ms: 3600 }, { sq: 2, lean: -1, ms: 400 }],
      done: [{ ms: 2400 }, { sq: 1, ms: 500 }],
    },
    intros: { replying: sparkled(hop(2, "happy"), 2), done: sparkled(hop(2, "happy"), 2), error: droop(false) },
    delightEvery: null,
    delights: [],
  },
  b: {
    loops: {
      thinking: [{ lean: 1, ms: 1100 }, { lean: 1, dy: 1, ms: 120 }, { lean: 1, ms: 1000 }, { lean: 1, sq: 1, ms: 400 }, { lean: -1, ms: 1100 }, { lean: -1, dy: 1, ms: 120 }, { lean: -1, ms: 1000 }, { lean: -1, sq: 1, ms: 400 }],
      searching: [{ sq: 1, ms: 80 }, ...peek(2, false).slice(0, 2), { sq: 1, ms: 80 }, ...peek(2, false).slice(2)],
      browsing: taps(1, 2, 700),
      running: taps(1, 2, 700),
      reading: [{ lean: -1, ms: 1200 }, { dy: 1, ms: 100 }, { lean: 1, ms: 1200 }, { dy: 1, ms: 100 }],
      writing: typing(420, 1, true),
      replying: typing(420, 1, true),
      waiting: taps(1, 2, 1300),
      error: [{ sq: 1, lean: -1, ms: 3200 }, { sq: 2, lean: -1, ms: 500 }, { sq: 1, lean: 1, ms: 300 }],
      done: [{ ms: 1800 }, ...hop(1, "happy")],
    },
    intros: { replying: sparkled(hop(3, "happy"), 2), done: sparkled(hop(3, "happy"), 2), error: droop(true) },
    delightEvery: [9000, 12000],
    delights: ["roll", "twirl"],
  },
  c: {
    loops: {
      thinking: [{ lean: 1, ms: 600 }, { ms: 300 }, { lean: -1, ms: 600 }, { ms: 300 }, { lean: 1, dy: 1, ms: 120 }, { lean: 1, ms: 700 }, { sq: 1, ms: 300 }],
      searching: [{ sq: 1, ms: 80 }, { dy: 1, ms: 80 }, ...peek(2, true).slice(0, 2), { sq: 1, ms: 80 }, { dy: 1, ms: 80 }, ...peek(2, true).slice(2)],
      browsing: taps(2, 2, 420),
      running: taps(2, 2, 420),
      reading: [{ lean: -1, ms: 900 }, { dy: 1, ms: 100 }, { lean: 1, ms: 900 }, { dy: 1, ms: 100 }],
      writing: [...typing(360, 1, true), ...typing(360, 2, true)],
      replying: [...typing(360, 1, true), ...typing(360, 2, true)],
      waiting: taps(2, 3, 1100),
      error: [{ sq: 1, lean: -1, ms: 2600 }, { sq: 2, lean: -1, ms: 500 }, { sq: 1, lean: 1, ms: 300 }, { sq: 2, ms: 300 }],
      done: [{ ms: 1400 }, ...hop(2, "happy")],
    },
    intros: { replying: sparkled([...hop(4, "happy"), ...hop(2, "happy")], 3), done: sparkled([...hop(4, "happy"), ...hop(2, "happy")], 3), error: droop(true) },
    delightEvery: [8000, 10000],
    delights: ["roll", "flip", "twirl", "jump"],
  },
};

const ROLL_ANGLES = [45, 90, 135, 180, 225, 270, 315];
const DELIGHT_STEPS: Record<Delight, readonly Step[]> = {
  roll: [
    { sq: 1, ms: 90 }, { sq: 2, ms: 60 },
    ...ROLL_ANGLES.map((rot, i) => ({ rot, dy: [1, 2, 2, 2, 2, 1, 1][i]!, dx: [0, 1, 1, 2, 2, 1, 1][i]!, eyesOff: rot >= 135 && rot <= 225, ms: 65 })),
    { sq: 1, ms: 90 }, { face: "happy", ms: 260 },
  ],
  flip: [
    { sq: 2, ms: 110 }, { dy: 1, sq: -1, ms: 50 }, { dy: 2, ms: 50 },
    ...[-45, -90, -135, -180, -225, -270, -315].map((rot, i) => ({ rot, dy: [3, 4, 4, 4, 4, 3, 2][i]!, eyesOff: rot <= -135 && rot >= -225, ms: 60 })),
    { dy: 1, ms: 50 }, { sq: 2, ms: 100 }, { sq: 1, face: "happy", ms: 100 }, { face: "happy", ms: 220 },
  ],
  twirl: [
    { sq: 1, ms: 80 }, { dy: 1, narrow: 0.6, ms: 70 }, { dy: 2, narrow: 0.25, eyesOff: true, ms: 70 }, { dy: 2, narrow: 0.6, eyesOff: true, ms: 70 },
    { dy: 1, narrow: 0.25, eyesOff: true, ms: 70 }, { dy: 1, narrow: 0.6, ms: 70 }, { sq: 1, ms: 90 }, { face: "happy", ms: 260 },
  ],
  jump: sparkled([...hop(4, "happy"), { face: "happy", ms: 200 }], 3),
};

const LOOKING_MOODS = new Set<WorkingMood>(["thinking", "reading", "searching"]);
const DELIGHT_MOODS = new Set<WorkingMood>(["thinking", "searching", "browsing", "running", "reading", "writing"]);

/** The faces each mood runs through in a/b/c; each holds at least 2 s. */
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

const total = (steps: readonly { ms: number }[]) => steps.reduce((sum, step) => sum + step.ms, 0);
export const delightMs = (kind: Delight): number => total(DELIGHT_STEPS[kind]);

function stepAt<T extends { ms: number }>(steps: readonly T[], t: number): T {
  let left = t;
  for (const step of steps) { if (left < step.ms) return step; left -= step.ms; }
  return steps[steps.length - 1]!;
}

function faceAt(mood: WorkingMood, t: number): Faced {
  const faces = FACES[mood];
  const once = faces.filter((face) => face.once), loop = faces.filter((face) => !face.once);
  const head = total(once);
  return t < head ? stepAt(once, t) : stepAt(loop, (t - head) % total(loop));
}

function rngOf(seed: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 16777619);
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const THINK_DOTS: readonly { extra: PoseExtra | null; ms: number }[] = [{ extra: null, ms: 500 }, { extra: "dots1", ms: 400 }, { extra: "dots2", ms: 400 }, { extra: "dots3", ms: 900 }, { extra: null, ms: 300 }];
const REDUCED_POSE: Partial<Record<WorkingMood, Partial<MascotPose>>> = { error: { sq: 1 } };

/** One mascot's choreography: feed it the mood as it changes and ask for the pose at each moment, times never going
 * back. Delights start at least DELIGHT_GAP_MS apart (first one no sooner than that after the start) and never the same
 * kind twice in a row; under reduced motion it holds one pose per mood. */
export class MascotDirector {
  readonly variant: MascotVariant;
  private readonly plan: Plan;
  private readonly rng: () => number;
  readonly reducedMotion: boolean;
  private readonly blinkEvery: number;
  private mood: WorkingMood = "thinking";
  private moodAt = 0;
  private nextDelight: number;
  private delight: { kind: Delight; at: number } | null = null;
  private lastKind: Delight | null = null;
  private look = 0;
  /** start times of every delight played, for tests and the lab */
  readonly played: Array<{ kind: Delight; at: number }> = [];

  constructor({ variant, seed = "", reduced = false, at = 0 }: { variant: MascotVariant; seed?: string; reduced?: boolean; at?: number }) {
    this.variant = variant;
    this.plan = PLANS[variant];
    this.rng = rngOf(`${variant}|${seed}`);
    this.reducedMotion = reduced;
    this.blinkEvery = 3400 + Math.floor(this.rng() * 1400);
    this.moodAt = at;
    this.nextDelight = at + this.gap();
  }

  private gap(): number {
    const every = this.plan.delightEvery;
    return every ? Math.max(DELIGHT_GAP_MS, every[0] + this.rng() * (every[1] - every[0])) : Infinity;
  }

  setMood(mood: WorkingMood, at: number): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.moodAt = at;
    if (this.delight && !DELIGHT_MOODS.has(mood)) this.delight = null;
  }

  private startDelight(at: number): void {
    const pool = this.plan.delights.filter((kind) => kind !== this.lastKind);
    const kind = pool[Math.floor(this.rng() * pool.length)]!;
    this.delight = { kind, at };
    this.lastKind = kind;
    this.played.push({ kind, at });
    this.nextDelight = at + this.gap();
  }

  pose(at: number): MascotPose {
    const mood = this.mood, t = Math.max(0, at - this.moodAt);
    const faced = this.reducedMotion ? FACES[mood].find((face) => !face.once)! : faceAt(mood, t);
    const base: MascotPose = { ...REST_POSE, face: faced.face };
    if (this.reducedMotion) return { ...base, ...REDUCED_POSE[mood] };
    const intro = this.plan.intros[mood];
    const introMs = intro ? total(intro) : 0;
    let step: Step;
    if (intro && t < introMs) step = stepAt(intro, t);
    else {
      if (this.delight && at - this.delight.at >= delightMs(this.delight.kind)) this.delight = null;
      if (!this.delight && at >= this.nextDelight && DELIGHT_MOODS.has(mood)) this.startDelight(at);
      const loop = this.plan.loops[mood] ?? [{ ms: 1000 }];
      step = this.delight ? stepAt(DELIGHT_STEPS[this.delight.kind], at - this.delight.at) : stepAt(loop, (t - introMs) % total(loop));
    }
    const { ms: _ms, face, ...moves } = step;
    if (LOOKING_MOODS.has(mood) && (moves.look || moves.lean)) this.look = moves.look || Math.sign(moves.lean!);
    const pose: MascotPose = { ...base, ...moves, face: face ?? base.face, look: LOOKING_MOODS.has(mood) && !this.delight ? this.look : 0 };
    if (!this.delight && mood === "thinking" && pose.extra === null) pose.extra = stepAt(THINK_DOTS, t % total(THINK_DOTS)).extra;
    const blinkMs = mood === "thinking" ? 220 : 120;
    pose.blink = !this.delight && pose.face !== "happy" && pose.face !== "sad" && at % this.blinkEvery < blinkMs;
    return pose;
  }
}
