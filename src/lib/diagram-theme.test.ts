import { describe, expect, it } from "vitest";
import { BRAND_SERIES, mermaidThemeVariables, mixHex, type DiagramTokens } from "./diagram-theme";

const dusk: DiagramTokens = {
  scheme: "dark", font: "Geist", ground: "#121014", card: "#231f27", surface: "#2a262d", ink: "#f4eff6", muted: "#b9afbd",
  hairline: "#403847", accent: "#765683", warning: "#d0a35d", danger: "#db727a",
};

describe("diagram theme", () => {
  it("mixes two opaque colours", () => {
    expect(mixHex("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(mixHex("#765683", "#231f27", 0)).toBe("#231f27");
  });

  it("draws nodes in the skin's accent and ink, and series in the brand's page colours", () => {
    const vars = mermaidThemeVariables(dusk);
    expect(vars.primaryTextColor).toBe(dusk.ink);
    expect(vars.primaryColor).toBe(mixHex(dusk.accent, dusk.surface, 0.3));
    expect(vars.darkMode).toBe(true);
    expect(vars.edgeLabelBackground).toBe(dusk.surface);
    expect(vars.pie1).toBe(BRAND_SERIES[0]);
    expect((vars.xyChart as Record<string, string>).plotColorPalette.split(", ")[0]).toBe(BRAND_SERIES[0]);
    for (const [name, value] of Object.entries(vars)) {
      if (typeof value === "string" && value.startsWith("#")) expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
