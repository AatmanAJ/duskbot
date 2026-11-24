import { describe, expect, it } from "vitest";

import { closeUnclosedFileLinks, originalOffset } from "./markdown-unclosed-destinations.ts";

const closed = (markdown: string) => closeUnclosedFileLinks(markdown).markdown;

describe("unclosed file link destinations", () => {
  it("closes an absolute local path left open before the link's parenthesis", () => {
    expect(closed("Done: [Proposal.docx](</Users/priya/Hollow Oak/Proposal.docx)."))
      .toBe("Done: [Proposal.docx](</Users/priya/Hollow Oak/Proposal.docx>).");
    expect(closed("[a](<C:\\Users\\Priya\\a b.md) [b](<file:///srv/b.pdf)"))
      .toBe("[a](<C:\\Users\\Priya\\a b.md>) [b](<file:///srv/b.pdf>)");
    expect(closed("(see [Report](</w/Report (final).docx))")).toBe("(see [Report](</w/Report (final).docx>))");
  });

  it("leaves well-formed links, plain text, web links and relative paths alone", () => {
    for (const text of [
      "[ok](</w/a b.docx>) and [ok](/w/c.docx)",
      "if a < b then [x](y)",
      "[site](<https://example.com/a b)",
      "[site](<//cdn.example/a.png)",
      "[rel](<notes/a.md)",
      "[a](</w/a.md\nb)",
    ]) expect(closed(text)).toBe(text);
  });

  it("never edits code", () => {
    const text = "`[a](</w/a.md)`\n\n```\n[b](</w/b.md)\n```";
    expect(closed(text)).toBe(text);
  });

  it("maps an offset in the closed text back to the original", () => {
    const text = "[a](</w/a.md) ![i](/w/i.png) [b](</w/b.md) ![j](/w/j.png)";
    const { markdown, inserted } = closeUnclosedFileLinks(text);
    expect(markdown).not.toBe(text);
    for (const image of ["![i]", "![j]"]) expect(originalOffset(markdown.indexOf(image), inserted)).toBe(text.indexOf(image));
  });
});
