import { describe, expect, it, vi } from "vitest";
import { DELIGHT_GAP_MS, MASCOT_MOTION, MascotDirector, type MascotMotion, type MascotVariant } from "./mascot-motion";
import { createTicker } from "./mascot-ticker";
import { WORKING_MOODS, type WorkingMood } from "./working-mood";

const VARIANTS: MascotVariant[] = ["card-calm", "card-balanced", "card-lively", "voxel-calm", "voxel-balanced", "voxel-lively"];

function play(director: MascotDirector, script: Array<[WorkingMood, number]>, step = 1000 / 60): MascotMotion[] {
  const frames: MascotMotion[] = [];
  let at = 0;
  for (const [mood, ms] of script) {
    director.setMood(mood, at);
    for (const end = at + ms; at < end; at += step) frames.push(director.motion(at));
  }
  return frames;
}

const LONG_TURN: Array<[WorkingMood, number]> = [["thinking", 14_000], ["searching", 9_000], ["browsing", 12_000], ["writing", 30_000], ["thinking", 3_000], ["running", 20_000], ["replying", 15_000], ["done", 4_000]];
const turnDiff = (a: number, b: number) => Math.abs(((((b - a + 180) % 360) + 360) % 360) - 180);

describe("the working mascot's 3D motion", () => {
  it("ships the current loops until one is picked", () => {
    expect(MASCOT_MOTION).toBe("current");
  });

  it.each(VARIANTS)("never starts two delights within 8 s, nor the same one twice running (%s)", (variant) => {
    for (const seed of ["nova", "quill", "rivet", "x", ""]) {
      const director = new MascotDirector({ variant, seed });
      play(director, LONG_TURN);
      const played = director.played;
      expect(played.length, "a long turn has a few").toBeGreaterThanOrEqual(4);
      expect(played[0]!.at).toBeGreaterThanOrEqual(DELIGHT_GAP_MS);
      for (let i = 1; i < played.length; i++) {
        expect(played[i]!.at - played[i - 1]!.at).toBeGreaterThanOrEqual(DELIGHT_GAP_MS);
        expect(played[i]!.kind).not.toBe(played[i - 1]!.kind);
      }
    }
  });

  it("plays no delight while it fails, waits or is done", () => {
    const director = new MascotDirector({ variant: "voxel-lively", seed: "s" });
    play(director, [["error", 30_000], ["waiting", 30_000], ["done", 30_000]]);
    expect(director.played).toEqual([]);
  });

  it.each(VARIANTS)("moves without a jump at 120 fps, even when the step changes mid-roll (%s)", (variant) => {
    const director = new MascotDirector({ variant, seed: "s" });
    const flicker = Array.from({ length: 90 }, (_, i): [WorkingMood, number] => [(["writing", "searching", "error", "thinking", "replying", "browsing"] as const)[i % 6], 300 + (i % 7) * 410]);
    const frames = play(director, [["thinking", 12_000], ...flicker, ...LONG_TURN], 1000 / 120);
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1]!, b = frames[i]!;
      expect(Math.abs(b.y - a.y), `y at ${i}`).toBeLessThan(0.05);
      expect(Math.abs(b.sy - a.sy), `sy at ${i}`).toBeLessThan(0.08);
      for (const k of ["rx", "ry", "rz"] as const) expect(turnDiff(a[k], b[k]), `${k} at ${i}`).toBeLessThan(14);
    }
  });

  it("holds one still pose per mood under reduced motion", () => {
    for (const variant of VARIANTS) {
      const director = new MascotDirector({ variant, seed: "s", reduced: true });
      for (const mood of WORKING_MOODS) {
        const keys = new Set(play(director, [[mood, 20_000]], 50).map((m) => JSON.stringify(m)));
        expect(keys.size, `${variant} ${mood}`).toBe(1);
      }
      expect(director.played).toEqual([]);
    }
  });

  it("spins and hops happily as the reply lands, and slumps on a failure", () => {
    const director = new MascotDirector({ variant: "card-calm", seed: "s" });
    director.setMood("replying", 0);
    const hop = Array.from({ length: 50 }, (_, i) => director.motion(400 + i * 20));
    expect(hop.every((m) => m.face === "happy")).toBe(true);
    expect(Math.min(...hop.map((m) => m.y))).toBeLessThan(-0.1);
    expect(Math.max(...hop.map((m) => turnDiff(0, m.ry)))).toBeGreaterThan(120);
    director.setMood("error", 2000);
    const slump = director.motion(5000);
    expect([slump.face, slump.sy < 0.95, slump.rz < 0]).toEqual(["sad", true, true]);
  });
});

describe("the mascots' shared frame loop", () => {
  const fakeClock = () => {
    let next = 1;
    const queued = new Map<number, (now: number) => void>();
    const listeners = new Set<() => void>();
    const doc = {
      hidden: false,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    const clock = { raf: vi.fn((fn: (now: number) => void) => { queued.set(next, fn); return next++; }), caf: vi.fn((id: number) => void queued.delete(id)), doc: doc as unknown as Document };
    const flush = (now: number) => { const fns = [...queued.values()]; queued.clear(); fns.forEach((fn) => fn(now)); };
    const setHidden = (hidden: boolean) => { doc.hidden = hidden; listeners.forEach((fn) => fn()); };
    return { clock, flush, setHidden, queued };
  };

  it("runs one loop for every mascot and stops while the page is hidden", () => {
    const { clock, flush, setHidden, queued } = fakeClock();
    const ticker = createTicker(clock);
    const a = vi.fn(), b = vi.fn();
    const offA = ticker.subscribe(a);
    ticker.subscribe(b);
    expect(queued.size).toBe(1);
    flush(16);
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
    setHidden(true);
    expect([ticker.running, queued.size]).toEqual([false, 0]);
    flush(32);
    expect(a).toHaveBeenCalledTimes(1);
    setHidden(false);
    flush(48);
    expect(a).toHaveBeenCalledTimes(2);
    offA();
    flush(64);
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([2, 3]);
  });

  it("stops when the last mascot leaves", () => {
    const { clock, queued } = fakeClock();
    const ticker = createTicker(clock);
    const off = ticker.subscribe(() => {});
    off();
    expect([ticker.running, queued.size]).toEqual([false, 0]);
  });
});
