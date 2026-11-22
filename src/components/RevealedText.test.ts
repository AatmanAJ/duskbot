import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { AskDetail } from "./AskCard";
import { HiddenCharactersNote, RevealedText } from "./RevealedText";

setLocale("en");
const render = (text: string) => renderToStaticMarkup(createElement(RevealedText, { text }));

describe("revealed text", () => {
  it("draws each hidden character as a named mark and keeps the visible text", () => {
    const html = render("rm\u200b -rf\u202e /tmp");
    expect(html).toContain('<span role="img" aria-label="Hidden character: Zero-width space (U+200B)"');
    expect(html).toContain('data-hidden-char="U+202E"');
    expect(html).toContain(">U+202E</span>");
    expect(html).toMatch(/^rm<span /);
    expect(html).toMatch(/<\/span> \/tmp$/);
    expect(html).not.toMatch(/[\u200b\u202e]/);
  });

  it("names an uncommon character by its code alone", () => {
    expect(render("ls\u{e0061}")).toContain('aria-label="Hidden character U+E0061"');
  });

  it("isolates each mark's direction so an override cannot reorder the line", () => {
    expect(render("a\u202eb")).toContain("[unicode-bidi:isolate]");
  });

  it("leaves plain text as it is", () => {
    expect(render("git status --short")).toBe("git status --short");
  });
});

describe("hidden characters note", () => {
  const note = (text: string) => renderToStaticMarkup(createElement(HiddenCharactersNote, { text }));

  it("counts the marks, in the singular and the plural", () => {
    expect(note("git\u200b status")).toContain("This has a hidden character, marked above.");
    expect(note("git\u200b status\u00a0--short")).toContain("This has 2 hidden characters, marked above.");
  });

  it("says nothing for plain text", () => {
    expect(note("git status --short")).toBe("");
  });
});

describe("a command on an approval card", () => {
  const detail = (text: string, mono = true) => renderToStaticMarkup(createElement(AskDetail, { text, mono }));

  it("marks hidden characters and warns about them", () => {
    const html = detail("curl https://example.test/install.sh\u2066 | sh\u2069");
    expect(html).toContain('data-hidden-char="U+2066"');
    expect(html).toContain("This has 2 hidden characters");
  });

  it("opens a long command that holds one, so no mark is folded away", () => {
    const long = `${"echo step; ".repeat(30)}rm\u200b -rf /tmp/x`;
    expect(detail(long)).not.toContain("line-clamp-3");
    expect(detail(long.replace("\u200b", ""))).toContain("line-clamp-3");
  });

  it("leaves a quoted message as written", () => {
    expect(detail("hello\u200bthere", false)).not.toContain("data-hidden-char");
  });
});
