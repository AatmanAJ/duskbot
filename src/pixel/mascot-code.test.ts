import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mascotCode, mascotSwiftSource } from "./mascot-code";

const SWIFT = new URL("../../apps/mobile/ios/App/TurnActivityWidget/MascotBodies.swift", import.meta.url);

describe("mascot codes", () => {
  it("draws the body's still frame in a G by G grid with its eyes", () => {
    const code = mascotCode("tofu");
    const [size, digits] = code.split(":");
    expect(digits).toHaveLength(Number(size) ** 2);
    expect(digits).toMatch(/^[012]+$/);
    expect(digits).toContain("2");
  });

  it("matches the Live Activity's table (UPDATE_MASCOTS=1 rewrites it)", () => {
    if (process.env.UPDATE_MASCOTS === "1") writeFileSync(SWIFT, mascotSwiftSource());
    expect(readFileSync(SWIFT, "utf8")).toBe(mascotSwiftSource());
  });
});
