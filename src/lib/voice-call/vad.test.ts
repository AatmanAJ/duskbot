import { describe, expect, it } from "vitest";
import { levelDb, soundsUnfinished, Vad } from "./vad";

const FRAME = 32;

function run(vad: Vad, levels: Array<[number, number]>, botSpeaking = false) {
  const events: Array<{ at: number; event: string }> = [];
  let now = 0;
  for (const [level, frames] of levels) {
    for (let i = 0; i < frames; i += 1) {
      now += FRAME;
      const event = vad.feed(level, FRAME, now, botSpeaking);
      if (event) events.push({ at: now, event });
    }
  }
  return events;
}

describe("Vad", () => {
  it("starts on a voice over the room's noise and ends after a pause", () => {
    const vad = new Vad();
    const events = run(vad, [[-62, 30], [-25, 20], [-62, 25]]);
    expect(events.map((e) => e.event)).toEqual(["start", "end"]);
    const [start, end] = events;
    expect(start!.at).toBe((30 + 3) * FRAME);
    expect(end!.at - (30 + 20) * FRAME).toBeGreaterThanOrEqual(640);
    expect(end!.at - (30 + 20) * FRAME).toBeLessThan(700);
  });

  it("ignores a click shorter than a syllable", () => {
    expect(run(new Vad(), [[-62, 30], [-20, 1], [-62, 30]])).toEqual([]);
  });

  it("learns a noisy room so its hum is not a voice", () => {
    const vad = new Vad();
    expect(run(vad, [[-42, 200]])).toEqual([]);
    expect(vad.floorDb).toBeGreaterThan(-44);
    expect(run(vad, [[-22, 10]]).map((e) => e.event)).toEqual(["start"]);
  });

  it("needs a louder, longer voice to cut in while the bot talks", () => {
    const quiet = new Vad();
    run(quiet, [[-62, 30]]);
    expect(run(quiet, [[-46, 12]], true)).toEqual([]);
    const firm = new Vad();
    run(firm, [[-62, 30]]);
    const events = run(firm, [[-30, 12]], true);
    expect(events.map((e) => e.event)).toEqual(["start"]);
    expect(events[0]!.at).toBeGreaterThanOrEqual(200);
  });

  it("measures a frame's loudness in dBFS", () => {
    expect(levelDb(new Float32Array(512).fill(1))).toBeCloseTo(0);
    expect(levelDb(new Float32Array(512).fill(0.1))).toBeCloseTo(-20);
    expect(levelDb(new Float32Array(512))).toBe(-100);
  });
});

describe("soundsUnfinished", () => {
  it("hears a trailing 'and' or 'um' as a pause for thought", () => {
    expect(soundsUnfinished("Book a table for two and")).toBe(true);
    expect(soundsUnfinished("so um")).toBe(true);
    expect(soundsUnfinished("Book a table for two.")).toBe(false);
    expect(soundsUnfinished("What's the weather")).toBe(false);
  });
});
