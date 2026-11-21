import { describe, expect, it } from "vitest";
import { PULSE_INTERVAL_MS } from "../../../../shared/machine-pulse";
import { nearestSample } from "./pulse-hover";

const at = (t: number) => ({ t, cpu: t / 1000, mem: 20 });
const samples = [at(0), at(PULSE_INTERVAL_MS), at(2 * PULSE_INTERVAL_MS), at(10 * PULSE_INTERVAL_MS)];

describe("nearestSample", () => {
  it("snaps to the closest sample", () => {
    expect(nearestSample(samples, PULSE_INTERVAL_MS * 0.4)?.t).toBe(0);
    expect(nearestSample(samples, PULSE_INTERVAL_MS * 0.6)?.t).toBe(PULSE_INTERVAL_MS);
  });
  it("keeps the same sample across small pointer moves so hover state does not churn", () => {
    const a = nearestSample(samples, PULSE_INTERVAL_MS * 0.9), b = nearestSample(samples, PULSE_INTERVAL_MS * 1.2);
    expect(a).toBe(b);
  });
  it("shows nothing inside a gap in the data", () => {
    expect(nearestSample(samples, 6 * PULSE_INTERVAL_MS)).toBeNull();
    expect(nearestSample([], 0)).toBeNull();
  });
});
