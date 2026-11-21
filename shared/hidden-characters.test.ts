import { describe, expect, it } from "vitest";

import { findHiddenCharacters, hasHiddenCharacters, revealHiddenCharacters, spellOutHiddenCharacters } from "./hidden-characters.ts";

describe("hidden characters", () => {
  it("leaves plain commands, tabs and line breaks alone", () => {
    expect(findHiddenCharacters("git status --short\n\tls -la\r\n")).toEqual([]);
    expect(hasHiddenCharacters("echo 'héllo wörld' && 日本語")).toBe(false);
  });

  it("marks zero-width, direction, lookalike-space and control characters with their offsets", () => {
    const text = "rm\u200b -rf\u00a0/tmp \u202eexe.txt\u001b[2K";
    expect(findHiddenCharacters(text).map(({ index, code, kind, name }) => ({ index, code, kind, name }))).toEqual([
      { index: 2, code: "U+200B", kind: "invisible", name: "Zero-width space" },
      { index: 7, code: "U+00A0", kind: "space", name: "No-break space" },
      { index: 13, code: "U+202E", kind: "direction", name: "Right-to-left override" },
      { index: 21, code: "U+001B", kind: "control", name: "U+001B" },
    ]);
  });

  it("marks tag letters that smuggle text and variation selectors outside emoji", () => {
    const smuggled = "ls\u{e0063}\u{e0061}\u{e0074}";
    expect(findHiddenCharacters(smuggled).map((hidden) => hidden.code)).toEqual(["U+E0063", "U+E0061", "U+E0074"]);
    expect(findHiddenCharacters("a\ufe0fb").map((hidden) => hidden.code)).toEqual(["U+FE0F"]);
    expect(findHiddenCharacters("echo \u3164").map((hidden) => hidden.kind)).toEqual(["invisible"]);
  });

  it("does not mark the joiners and selectors that build an emoji", () => {
    expect(findHiddenCharacters("git commit -m '\u2764\ufe0f \u{1f468}\u200d\u{1f469}\u200d\u{1f467} \u{1f44d}\u{1f3fd}\u200d 1\ufe0f\u20e3 \u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}'")
      .map((hidden) => hidden.code)).toEqual(["U+200D"]);
  });

  it("splits text so each hidden character stands alone and nothing is lost", () => {
    const text = "\u200bcurl x\u2066|sh\u2069";
    const parts = revealHiddenCharacters(text);
    expect(parts.map((part) => ("text" in part ? part.text : part.hidden.code))).toEqual(["U+200B", "curl x", "U+2066", "|sh", "U+2069"]);
    expect(parts.map((part) => ("text" in part ? part.text : part.hidden.char)).join("")).toBe(text);
    expect(revealHiddenCharacters("plain")).toEqual([{ text: "plain" }]);
    expect(revealHiddenCharacters("")).toEqual([]);
  });

  it("counts a lone surrogate as a control character", () => {
    expect(findHiddenCharacters("a\ud800b").map((hidden) => hidden.kind)).toEqual(["control"]);
  });

  it("spells hidden characters out as codes for plain-string places", () => {
    expect(spellOutHiddenCharacters("rm\u202e -rf")).toBe("rm[U+202E] -rf");
    expect(spellOutHiddenCharacters("git status")).toBe("git status");
  });
});
