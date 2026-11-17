import { describe, expect, it } from "vitest";

import { newElements } from "./after-action.ts";
import { coverAdvice, samplePoints } from "./cdp/cover.ts";
import { sliderNumber } from "./cdp/slider.ts";

const TREE = [
  "- heading \"Inbox\" [level=1]",
  "- button \"Compose\" [ref=e2]",
  "- dialog \"New Message\":",
  "  - text: To",
  "  - textbox \"To recipients\" [ref=e9]",
  "  - group:",
  "    - textbox \"Subject\" [ref=e10]",
  "  - button \"Send\" [ref=e11]",
  "- link \"Help\" [ref=e3]",
].join("\n");

describe("what an action brought up", () => {
  it("lists only refs newer than the mark, under the dialog they opened in", () => {
    expect(newElements(TREE, 8)).toEqual({
      count: 3,
      text: ["- dialog \"New Message\":", "  - textbox \"To recipients\" [ref=e9]", "  - group:", "    - textbox \"Subject\" [ref=e10]", "  - button \"Send\" [ref=e11]"].join("\n"),
    });
  });

  it("says nothing when the action brought up no control", () => {
    expect(newElements(TREE, 11)).toBeNull();
  });

  it("stops at the line budget and says how many more there are", () => {
    const options = Array.from({ length: 60 }, (_, i) => `  - option "Country ${i}" [ref=e${100 + i}]`);
    const found = newElements(["- listbox:", ...options].join("\n"), 99, 40)!;
    expect(found.count).toBe(60);
    expect(found.text.split("\n")).toHaveLength(42);
    expect(found.text).toMatch(/and 20 more; take a snapshot/);
  });
});

describe("clicking past what covers an element", () => {
  it("tries the middle of the element first, inside its edges", () => {
    const points = samplePoints([10, 20, 110, 20, 110, 60, 10, 60]);
    expect(points[0]).toEqual([60, 40]);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThan(10);
      expect(x).toBeLessThan(110);
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThan(60);
    }
  });

  it("names the button that closes a fixed bar, or says to answer a dialog", () => {
    expect(coverAdvice({ disabled: false, covering: "<div.chat>", fixed: { top: 700, bottom: 800, height: 100, busy: false, closer: "Close chat banner", dialog: false } }))
      .toMatch(/stays fixed on the screen.*role=button\[name="Close chat banner"\]/u);
    expect(coverAdvice({ disabled: false, covering: "<div.wall>", fixed: { top: 0, bottom: 800, height: 800, busy: false, closer: null, dialog: true } }))
      .toMatch(/under a dialog.*Answer or close that dialog first/u);
    expect(coverAdvice({ disabled: false, covering: "<span.box>", fixed: null })).toBe("The element is covered by <span.box>, which would get the click.");
  });
});

describe("a slider's value from what the bot typed", () => {
  it("reads the number in a price, a percentage or a plain value", () => {
    expect(sliderNumber("$750")).toBe(750);
    expect(sliderNumber("1,200.5")).toBe(1200.5);
    expect(sliderNumber("75%")).toBe(75);
    expect(sliderNumber("-3")).toBe(-3);
    expect(sliderNumber("max")).toBeNull();
  });
});
