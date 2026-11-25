// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { NoteMeta, facts, touched, type Note } from "./Feedback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function mount(note: Note) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(NoteMeta, { note })));
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}
const bad: Note = { id: "b1", kind: "bad", at: 1, text: "x", engine: "claude", category: "email", tools: ["app", "browser"], apps: ["gmail", "google_sheets"],
  signals: ["retried", "corrective", "swearing", "failed"], retries: 3, where: "mac", version: "0.2.15" };

describe("feedback note meta", () => {
  it("says what the person did in plain words, with the retry count", () => {
    expect(facts(bad)).toBe("asked again 3×, corrected it, swore, turns failed · email · claude");
    expect(facts({ id: "s", kind: "big", at: 1, text: null, turns: 16, minutes: 1, failed: 3 })).toBe("16 turns over 1 min, 3 failed");
  });
  it("lists apps then tools, up to four, and counts the rest", () => {
    expect(touched(bad)).toEqual({ shown: ["gmail", "google sheets", "browser"], more: 0 });
    const many = touched({ ...bad, apps: ["a", "b", "c"], tools: ["app", "browser", "terminal", "files"] });
    expect(many.shown).toEqual(["a", "b", "c", "browser"]);
    expect(many.more).toBe(2);
  });
  it("shows where it ran with the version and the tools, and never a way to a person", () => {
    const { host, done } = mount(bad);
    expect(host.textContent).toContain("mac · v0.2.15");
    expect(host.textContent).toContain("google sheets");
    expect(host.querySelector("a")).toBeNull();
    done();
  });
  it("leaves out what the note does not have, and renders nothing when it has none of it", () => {
    const plain = mount({ id: "w", kind: "weekly", at: 1, text: "x", turns: 5, days: 2 });
    expect(plain.host.innerHTML).toBe("");
    plain.done();
    const partial = mount({ ...bad, where: undefined, version: undefined, tools: [], apps: [] });
    expect(partial.host.innerHTML).toBe("");
    partial.done();
  });
});
