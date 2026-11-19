import { describe, expect, it, vi } from "vitest";
import { handleBack } from "./platform";

describe("Android's back", () => {
  it("goes to the newest layer only, and to an older one only when it declines", () => {
    const app = vi.fn(() => true);
    const fullScreen = vi.fn(() => true);
    expect(handleBack([app, fullScreen])).toBe(true);
    expect(fullScreen).toHaveBeenCalledOnce();
    expect(app).not.toHaveBeenCalled();

    const firstStep = vi.fn(() => false);
    expect(handleBack([app, firstStep])).toBe(true);
    expect(app).toHaveBeenCalledOnce();
  });

  it("is taken by nobody on the first screen, so the app goes to the background", () => {
    expect(handleBack([() => false])).toBe(false);
    expect(handleBack([])).toBe(false);
  });
});
