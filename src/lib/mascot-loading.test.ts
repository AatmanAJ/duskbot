import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import { PICKER_COLORS } from "./mascot";
import {
  ARRIVE_FROM, ARRIVE_MS, BEAT_MS, LOADING_CREW, LOADING_MOODS, arrivePose, beatPose, cheerPose, loadingFace, loadingLineAt, napPose,
  pickLoadingLook, still,
} from "./mascot-loading";

describe("the loading mascot's moves", () => {
  it("is one of the startup crew, in a colour its white eyes read on", () => {
    for (let i = 0; i < 20; i++) {
      const look = pickLoadingLook(null, () => i / 20);
      expect(LOADING_CREW).toContain(look.crew);
      expect(look.color).not.toBe("yellow");
    }
  });

  it("hops in from the right and lands on its spot", () => {
    expect(arrivePose(0).x).toBe(ARRIVE_FROM);
    expect(arrivePose(0).alpha).toBe(0);
    expect(arrivePose(ARRIVE_MS).x).toBe(0);
    expect(arrivePose(ARRIVE_MS).sy).toBeLessThan(1);
  });

  it("crouches, jumps, squashes on landing and comes back round", () => {
    expect(beatPose("hop", 60).sy).toBeLessThan(1);
    expect(beatPose("hop", 230).y).toBeLessThan(-4);
    expect(beatPose("hop", 380).sx).toBeGreaterThan(1);
    const after = beatPose("hop", BEAT_MS.hop);
    expect([after.y, after.sx, after.sy]).toEqual([0, 1, 1]);
  });

  it("looks both ways, naps with z's, cheers with squinting eyes", () => {
    expect([beatPose("look", 300).look, beatPose("look", 900).look]).toEqual([-1, 1]);
    expect(napPose(500).eyes).toBe("sleeping");
    expect(napPose(500).z).toHaveLength(3);
    expect(cheerPose(130).eyes).toBe("happy");
    expect(cheerPose(130).y).toBeLessThan(0);
  });

  it("keeps the eyes and drops the movement for reduced motion", () => {
    const calm = still(beatPose("hop", 230));
    expect([calm.y, calm.sx, calm.sy]).toEqual([0, 1, 1]);
    expect(still(beatPose("think", 400)).eyes).toBe("thinking");
  });
});

describe("the loading mascot", () => {
  it("never wears the colour the last launch wore", () => {
    for (let i = 0; i < PICKER_COLORS.length; i++) {
      const random = () => i / PICKER_COLORS.length;
      expect(pickLoadingLook("blue", random).color).not.toBe("blue");
    }
    expect(PICKER_COLORS).toContain(pickLoadingLook(null, () => 0.999).color);
    expect(LOADING_MOODS).toContain(pickLoadingLook(null, () => 0.5).mood);
  });

  it("keeps its mood, then naps and wakes once the wait runs long", () => {
    expect(loadingFace(0, "thinking", null)).toBe("thinking");
    expect(loadingFace(8000, "thinking", null)).toBe("thinking");
    expect(loadingFace(9500, "thinking", null)).toBe("sleeping");
    expect(loadingFace(12000, "thinking", null)).toBe("waking");
    expect(loadingFace(14000, "thinking", null)).toBe("thinking");
    expect(loadingFace(29500, "thinking", null)).toBe("sleeping");
  });

  it("naps first when the computer is still starting", () => {
    expect(loadingFace(1500, "searching", 1200)).toBe("sleeping");
    expect(loadingFace(4000, "searching", 1200)).toBe("waking");
    expect(loadingFace(6000, "searching", 1200)).toBe("searching");
  });

  it("says Loading first, then short playful lines, never anything about a cloud waking", () => {
    expect(loadingLineAt(0, "searching")).toBe("loading.line.loading");
    expect(loadingLineAt(2500, "searching")).toBe("loading.line.warmingUp");
    expect(loadingLineAt(3000, "sleeping")).toBe("loading.line.stretching");
    const said = new Set<string>();
    for (let at = 0; at < 60_000; at += 500) said.add(en[loadingLineAt(at, loadingFace(at, "waiting", null))]);
    expect(said.size).toBeGreaterThan(4);
    for (const line of said) expect(line).not.toMatch(/cloud|server|connect|\u2014/i);
  });
});
