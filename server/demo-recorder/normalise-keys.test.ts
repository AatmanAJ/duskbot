import { describe, expect, it } from "vitest";

import { demoStepSentence } from "../../shared/demo-recording.ts";
import type { RawDemoEvent, RawDemoTarget } from "./events.ts";
import { normaliseDemo } from "./normalise.ts";

const URL = "https://portal.example/search";
const field = (label: string): RawDemoTarget => ({ role: "textbox", name: "", label, tag: "input", inputType: "text", editable: true, interactive: true, form: 1 });
const button = (name: string): RawDemoTarget => ({ role: "button", name, tag: "input", inputType: "submit", interactive: true, form: 1 });
const at = (ms: number, type: RawDemoEvent["type"], target?: RawDemoTarget, extra: Partial<RawDemoEvent> = {}): RawDemoEvent => ({ at: ms, type, url: URL, ...(target ? { target } : {}), ...extra });

describe("what the keyboard does to a form", () => {
  it("takes Enter in a field as the step, not the click on the form's button the browser reports with it", () => {
    const steps = normaliseDemo([
      at(1_000, "open"),
      at(2_000, "input", field("Merchant"), { value: "Lyft" }),
      at(3_000, "key", field("Merchant"), { key: "Enter" }),
      at(3_004, "click", button("Search")),
      at(3_006, "submit", { role: "form", name: "", tag: "form", form: 1 }),
      at(3_010, "change", field("Merchant"), { value: "Lyft" }),
    ]);
    expect(steps.map(demoStepSentence)).toEqual([
      `Open ${URL}.`,
      'Type "Lyft" into the field labelled "Merchant".',
      'Press Enter in the field labelled "Merchant".',
    ]);
  });

  it("keeps a button the person really clicked after pressing Enter elsewhere", () => {
    const steps = normaliseDemo([
      at(1_000, "open"),
      at(2_000, "input", field("Merchant"), { value: "Lyft" }),
      at(3_000, "key", field("Merchant"), { key: "Enter" }),
      at(9_000, "click", button("Export")),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["open", "fill", "press", "click"]);
  });

  it("makes nothing of a field that is told again what it already holds", () => {
    const steps = normaliseDemo([
      at(1_000, "open"),
      at(2_000, "input", field("Merchant"), { value: "Lyft" }),
      at(3_000, "click", button("Check")),
      at(3_500, "change", field("Merchant"), { value: "Lyft" }),
      at(4_000, "input", field("Merchant"), { value: "Lyft Inc" }),
    ]);
    expect(steps.map((step) => [step.kind, step.value ?? step.target?.name])).toEqual([["open", undefined], ["fill", "Lyft"], ["click", "Check"], ["fill", "Lyft Inc"]]);
  });
});
