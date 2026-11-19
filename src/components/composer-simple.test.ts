import { describe, expect, it } from "vitest";
import { composerPlaceholder } from "./composer-simple";

const base = { locked: false, approval: false, attaching: false, listening: false, replying: false, busy: false, members: [], goal: false, botName: "Pip", setupHint: null, question: true };

describe("the composer's hint while a question waits", () => {
  it("says it answers the question or talks past it where there is room", () => {
    expect(composerPlaceholder(base)).toBe("Type your answer, or talk about something else");
  });

  it("keeps to a hint that fits a phone's field", () => {
    expect(composerPlaceholder({ ...base, narrow: true })).toBe("Type your answer");
  });
});
