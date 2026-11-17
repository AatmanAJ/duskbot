import { describe, expect, it } from "vitest";

import { around, newElements } from "./after-action.ts";
import { coverAdvice, samplePoints } from "./cdp/cover.ts";
import { sliderNumber } from "./cdp/slider.ts";
import { errorsNote } from "./page-errors.ts";

describe("the error line after an action", () => {
  it("names a new error first, then one still showing, and says nothing without errors", () => {
    expect(errorsNote([], ["We couldn't find that account."])).toBe("The page now shows an error: \"We couldn't find that account.\". Read it before anything else: repeating the same action will not get past it.");
    expect(errorsNote(["Required"], ["Required"])).toBe("The page still shows an error: \"Required\".");
    expect(errorsNote(["Old"], ["Old", "New"])).toMatch(/now shows an error: "New".*Still showing: "Old"\./u);
    expect(errorsNote(["Gone"], [])).toBeNull();
  });
});

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

  it("reads a nameless row by the text under it", () => {
    const rows = ["- grid:", "  - generic [ref=e40] [cursor=pointer]:", "    - text: Priya Raman", "    - text: 11/02", "  - generic [ref=e41] [cursor=pointer]:", "    - text: Sam Ortiz"].join("\n");
    expect(newElements(rows, 39)?.text).toBe("- grid:\n  - generic [ref=e40] [cursor=pointer]: Priya Raman\n  - generic [ref=e41] [cursor=pointer]: Sam Ortiz");
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

describe("where a text scrolled to sits", () => {
  const FEED = [
    "- heading \"Home\" [level=1]",
    "- article:",
    "  - text: \"@sora · 17h\"",
    "  - text: Ceramics studio tour next week",
    "  - button \"Like\" [ref=e40]",
    "- article:",
    "  - text: \"@lena_k · 42h\"",
    "  - text: Went to my first ceramics class last night",
    "  - button \"Reply\" [ref=e51]",
    "  - button \"Like\" [ref=e52]",
  ].join("\n");

  it("shows the whole item holding the text, with its refs", () => {
    expect(around(FEED, "first ceramics class")).toBe(["- article:", "  - text: \"@lena_k · 42h\"", "  - text: Went to my first ceramics class last night", "  - button \"Reply\" [ref=e51]", "  - button \"Like\" [ref=e52]"].join("\n"));
  });

  it("says nothing when the text is not in the tree", () => {
    expect(around(FEED, "pottery")).toBeNull();
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
