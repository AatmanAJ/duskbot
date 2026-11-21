import { describe, expect, it } from "vitest";

import { QUOTE_MAX_CHARS, hasQuotedLines, quoteBlock, quotedRuns, requestQuote, withQuote } from "./quote-selection";

describe("quoting a selection", () => {
  it("turns selected lines into a block quote, dropping outer blank lines and trailing spaces", () => {
    expect(quoteBlock("\n\nFirst line  \r\nsecond line\n\n\n\nafter a gap\n")).toBe("> First line\n> second line\n>\n> after a gap");
    expect(quoteBlock("  \n \t")).toBe("");
  });

  it("cuts a very long selection with an ellipsis", () => {
    const block = quoteBlock("a".repeat(QUOTE_MAX_CHARS + 50));
    expect(block).toBe(`> ${"a".repeat(QUOTE_MAX_CHARS)}…`);
  });

  it("puts the quote after what is written, with a blank line to answer on", () => {
    expect(withQuote("", "Ship on Friday?")).toBe("> Ship on Friday?\n\n");
    expect(withQuote("About this:  \n", "Ship on Friday?")).toBe("About this:\n\n> Ship on Friday?\n\n");
    expect(withQuote("Keep me", "   ")).toBe("Keep me");
  });

  it("reads a sent message back as quoted and plain runs", () => {
    expect(quotedRuns("> Ship on Friday?\n>\n> Or Monday\n\nFriday works.")).toEqual([
      { quote: true, text: "Ship on Friday?\n\nOr Monday" },
      { quote: false, text: "\nFriday works." },
    ]);
    expect(quotedRuns("plain only")).toEqual([{ quote: false, text: "plain only" }]);
    expect(hasQuotedLines("a > b")).toBe(false);
    expect(hasQuotedLines("x\n>quoted")).toBe(true);
  });

  it("only sends a quote to a conversation whose message box is open", () => {
    expect(requestQuote("no-such-thread", "hello")).toBe(false);
  });
});
