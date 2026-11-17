import { describe, expect, it } from "vitest";

import type { RawDemoEvent, RawDemoTarget } from "./events.ts";
import { normaliseDemo } from "./normalise.ts";

const URL = "https://admin.example/settings";
const field = (label: string, form = 1): RawDemoTarget => ({ role: "textbox", name: "", label, tag: "input", inputType: "text", editable: true, interactive: true, form });
const password = (label: string, shape: Partial<RawDemoTarget>): RawDemoTarget => ({ role: "textbox", name: "", label, tag: "input", inputType: "password", editable: true, interactive: true, sensitive: true, form: 1, ...shape });
const button = (name: string): RawDemoTarget => ({ role: "button", name, tag: "button", interactive: true, form: 1 });
const at = (ms: number, type: RawDemoEvent["type"], target?: RawDemoTarget, extra: Partial<RawDemoEvent> = {}): RawDemoEvent => ({ at: ms, type, url: URL, ...(target ? { target } : {}), ...extra });
const kinds = (events: RawDemoEvent[]) => normaliseDemo(events).map((step) => step.kind);

describe("a password box that is not a sign-in", () => {
  it("takes a name and one password as a sign-in, and keeps neither", () => {
    const steps = normaliseDemo([
      at(1_000, "open"),
      at(2_000, "input", field("User ID"), { value: "ada" }),
      at(3_000, "input", password("Password", { passwords: 1, fields: 1 })),
      at(4_000, "click", button("Sign in")),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["open", "sign-in"]);
    expect(JSON.stringify(steps)).not.toContain("ada");
  });

  it("leaves a form that sets a password to a person, and keeps what else was typed in it", () => {
    const twice = [
      at(1_000, "open"),
      at(2_000, "input", field("Full name"), { value: "Grace Hopper" }),
      at(3_000, "input", password("Password", { passwords: 2, fields: 1 })),
      at(4_000, "input", password("Confirm password", { passwords: 2, fields: 1 })),
      at(5_000, "click", button("Create user")),
    ];
    expect(kinds(twice)).toEqual(["open", "fill", "protected", "protected", "click"]);

    const marked = [at(1_000, "open"), at(2_000, "input", password("Password", { passwords: 1, fields: 1, newPassword: true })), at(3_000, "click", button("Save"))];
    expect(kinds(marked)).toEqual(["open", "protected", "click"]);
  });

  it("does not take a settings form with one password among many fields for a sign-in", () => {
    const steps = normaliseDemo([
      at(1_000, "open"),
      at(2_000, "input", field("SMTP host"), { value: "smtp.example" }),
      at(3_000, "input", field("Port"), { value: "587" }),
      at(4_000, "input", field("From address"), { value: "ops@example.org" }),
      at(5_000, "input", password("SMTP password", { passwords: 1, fields: 4 })),
      at(6_000, "click", button("Save")),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["open", "fill", "fill", "fill", "protected", "click"]);
    expect(steps.some((step) => step.kind === "sign-in")).toBe(false);
  });
});

describe("what counts as something new", () => {
  it("records the same value typed again on the next page", () => {
    const steps = normaliseDemo([
      at(1_000, "open"),
      at(2_000, "input", field("Quantity"), { value: "1" }),
      at(3_000, "click", button("Add")),
      { ...at(3_400, "open"), url: `${URL}?added=1` },
      at(5_000, "input", field("Quantity"), { value: "1" }),
      at(6_000, "click", button("Add")),
    ]);
    expect(steps.map((step) => step.kind)).toEqual(["open", "fill", "click", "fill", "click"]);
  });

  it("records a typed value that matches what the field held before the page cleared it", () => {
    expect(kinds([
      at(1_000, "open"),
      at(2_000, "input", field("Quantity"), { value: "1" }),
      at(3_000, "click", button("Add")),
      at(5_000, "input", field("Quantity"), { value: "1" }),
    ])).toEqual(["open", "fill", "click", "fill"]);
  });

  it("takes a page opened long after a click as a page the person went to", () => {
    const later = [at(1_000, "open"), at(2_000, "click", button("Refresh totals")), { ...at(40_000, "open"), url: "https://admin.example/reports" }];
    expect(kinds(later)).toEqual(["open", "click", "open"]);
    const soon = [at(1_000, "open"), at(2_000, "click", button("Reports")), { ...at(4_500, "open"), url: "https://admin.example/reports" }];
    expect(kinds(soon)).toEqual(["open", "click"]);
  });
});
