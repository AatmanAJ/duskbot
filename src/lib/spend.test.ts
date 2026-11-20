import { describe, expect, it } from "vitest";

import { forecastLine, forecastWarning, type RoutineForecast } from "./spend";

const forecast = (runsPerWeek: number | null, more: Partial<RoutineForecast> = {}): RoutineForecast => ({ runsPerWeek, perRunUsd: null, weekUsd: null, shareOfWeek: null, warnings: [], runCosts: {}, spentUsd: 0, ...more });

describe("forecastLine", () => {
  it("says one run a week as once, and counts the rest", () => {
    expect(forecastLine(forecast(1))).toBe("About once a week · Cost shows after its first run");
    expect(forecastLine(forecast(5))).toBe("About 5 runs a week · Cost shows after its first run");
  });

  it("says a one-time routine runs once, with no week or share", () => {
    expect(forecastLine(forecast(1, { perRunUsd: 0.01, weekUsd: 0.01, shareOfWeek: 0.25 }), { once: true })).toBe("Runs once · About $0.01");
    expect(forecastLine(forecast(0, { perRunUsd: 0.01, weekUsd: 0, shareOfWeek: 0 }), { once: true })).toBe("Runs once · About $0.01");
    expect(forecastLine(forecast(1), { once: true })).toBe("Runs once · Cost shows after its first run");
  });

  it("names the share once, in the warning, when it is costly", () => {
    const costly = forecast(7, { perRunUsd: 2, weekUsd: 14, shareOfWeek: 1, warnings: ["costly"] });
    expect(forecastLine(costly)).toBe("About 7 runs a week · About $14.00 a week");
    expect(forecastWarning("costly", costly)).toBe("This would be 100% of your week's use.");
    expect(forecastLine(forecast(7, { perRunUsd: 0.1, weekUsd: 0.7, shareOfWeek: 0.05 }))).toBe("About 7 runs a week · About $0.70 a week · 5% of your week");
  });
});
