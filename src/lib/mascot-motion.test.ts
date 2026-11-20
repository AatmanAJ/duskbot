import { describe, expect, it, vi } from "vitest";
import { poseArt, poseKey } from "@/pixel/pose-frame";
import { DELIGHT_GAP_MS, MASCOT_MOTION, MascotDirector, type MascotVariant } from "./mascot-motion";
import { createTicker } from "./mascot-ticker";
import { WORKING_MOODS, type WorkingMood } from "./working-mood";

const FRAME = 1000 / 60;

function play(director: MascotDirector, script: Array<[WorkingMood, number]>) {
  const keys: string[] = [];
  let at = 0;
  for (const [mood, ms] of script) {
    director.setMood(mood, at);
    for (const end = at + ms; at < end; at += FRAME) keys.push(poseKey(director.pose(at)));
  }
  return keys;
}

const LONG_TURN: Array<[WorkingMood, number]> = [["thinking", 14_000], ["searching", 9_000], ["browsing", 12_000], ["writing", 30_000], ["thinking", 3_000], ["running", 20_000], ["replying", 15_000], ["done", 4_000]];

describe("the working mascot's choreography", () => {
  it("ships the current loops until a variant is picked", () => {
    expect(MASCOT_MOTION).toBe("current");
  });

  it.each(["b", "c"] as MascotVariant[])("never starts two delights within 8 s, nor the same one twice running (%s)", (variant) => {
    for (const seed of ["nova", "quill", "rivet", "x", ""]) {
      const director = new MascotDirector({ variant, seed });
      play(director, LONG_TURN);
      const played = director.played;
      expect(played.length, "a long turn has a few").toBeGreaterThanOrEqual(5);
      expect(played[0]!.at).toBeGreaterThanOrEqual(DELIGHT_GAP_MS);
      for (let i = 1; i < played.length; i++) {
        expect(played[i]!.at - played[i - 1]!.at).toBeGreaterThanOrEqual(DELIGHT_GAP_MS);
        expect(played[i]!.kind).not.toBe(played[i - 1]!.kind);
      }
    }
  });

  it("keeps the gap across quick mood changes", () => {
    const director = new MascotDirector({ variant: "c", seed: "s" });
    const flicker = Array.from({ length: 60 }, (_, i): [WorkingMood, number] => [i % 3 ? "writing" : "error", 700 + (i % 5) * 300]);
    play(director, flicker);
    const starts = director.played.map((d) => d.at);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(DELIGHT_GAP_MS);
  });

  it("plays no delight in the subtle variant, nor while it fails, waits or is done", () => {
    const subtle = new MascotDirector({ variant: "a", seed: "s" });
    play(subtle, LONG_TURN);
    expect(subtle.played).toEqual([]);
    const lively = new MascotDirector({ variant: "c", seed: "s" });
    play(lively, [["error", 30_000], ["waiting", 30_000], ["done", 30_000]]);
    expect(lively.played).toEqual([]);
  });

  it("holds one still pose per mood under reduced motion", () => {
    for (const variant of ["a", "b", "c"] as MascotVariant[]) {
      const director = new MascotDirector({ variant, seed: "s", reduced: true });
      for (const mood of WORKING_MOODS) {
        const keys = new Set(play(director, [[mood, 20_000]]));
        expect(keys.size, `${variant} ${mood}`).toBe(1);
        const pose = director.pose(20_000);
        expect([pose.dx, pose.dy, pose.rot, pose.lean, pose.extra, pose.blink]).toEqual([0, 0, 0, 0, null, false]);
      }
      expect(director.played).toEqual([]);
    }
  });

  it("lands a reply with a happy hop and a sparkle, and droops on a failure", () => {
    const director = new MascotDirector({ variant: "b", seed: "s" });
    const at = (ms: number) => director.pose(ms);
    director.setMood("replying", 0);
    const hop = Array.from({ length: 40 }, (_, i) => at(i * 20));
    expect(hop.every((pose) => pose.face === "happy")).toBe(true);
    expect(Math.max(...hop.map((pose) => pose.dy))).toBeGreaterThanOrEqual(2);
    expect(hop.some((pose) => pose.extra?.startsWith("spark"))).toBe(true);
    director.setMood("error", 1000);
    const late = at(3000);
    expect([late.face, late.sq > 0]).toEqual(["sad", true]);
  });

  it("moves only in whole sprite pixels, so every frame is a crisp grid", () => {
    const director = new MascotDirector({ variant: "c", seed: "s" });
    let at = 0;
    for (const [mood, ms] of LONG_TURN) {
      director.setMood(mood, at);
      for (const end = at + ms; at < end; at += 50) {
        const pose = director.pose(at);
        for (const v of [pose.dx, pose.dy, pose.sq, pose.lean]) expect(Number.isInteger(v)).toBe(true);
        expect(Math.abs(pose.rot % 45)).toBe(0);
        expect(poseArt("kit", pose).body).toMatch(/^(M-?\d+ -?\d+h\d+v1h-\d+z)+$/);
      }
    }
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
