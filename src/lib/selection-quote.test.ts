import { describe, expect, it } from "vitest";

import { cleanSelectionText, selectionQuoteFor, setSelectionQuote, splitSelectionQuote, withSelectionQuote } from "./selection-quote";
import { asksAboutSelection, pillPlace } from "@/components/SelectionAskPill";

describe("asking about part of a message", () => {
  it("sends the selected words as a block quote above what the person wrote", () => {
    expect(withSelectionQuote("record the walkthrough video", "why this day?"))
      .toBe("> record the walkthrough video\n\nwhy this day?");
    expect(withSelectionQuote("first line\n\nsecond line", "explain")).toBe("> first line\n>\n> second line\n\nexplain");
    expect(withSelectionQuote(null, "plain")).toBe("plain");
    expect(withSelectionQuote("   ", "plain")).toBe("plain");
  });

  it("reads the quote back out of a sent message to show it as its own block", () => {
    expect(splitSelectionQuote(withSelectionQuote("first line\n\nsecond line", "explain")))
      .toEqual({ quote: "first line\n\nsecond line", rest: "explain" });
    expect(splitSelectionQuote("> only a quote")).toEqual({ quote: "only a quote", rest: "" });
    expect(splitSelectionQuote("no quote here\n> later line")).toBeNull();
    expect(splitSelectionQuote(">")).toBeNull();
  });

  it("tidies what the browser hands back for a selection", () => {
    expect(cleanSelectionText("  Wednesday: record \r\n\r\n\r\n\r\nthe video  \n")).toBe("Wednesday: record\n\nthe video");
  });

  it("holds one quote per draft until it is cleared", () => {
    setSelectionQuote("bot:a:t1", " the video ");
    setSelectionQuote("bot:b:t1", "another");
    expect(selectionQuoteFor("bot:a:t1")).toBe("the video");
    setSelectionQuote("bot:a:t1", null);
    expect(selectionQuoteFor("bot:a:t1")).toBeNull();
    expect(selectionQuoteFor("bot:b:t1")).toBe("another");
    setSelectionQuote("bot:b:t1", "");
    expect(selectionQuoteFor("bot:b:t1")).toBeNull();
  });

  it("takes ⌘L on a Mac and Ctrl+L elsewhere, with no other modifier", () => {
    const key = (patch: Partial<KeyboardEvent>) => ({ key: "l", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...patch });
    expect(asksAboutSelection(key({ metaKey: true }), true)).toBe(true);
    expect(asksAboutSelection(key({ key: "L", metaKey: true }), true)).toBe(true);
    expect(asksAboutSelection(key({ ctrlKey: true }), true)).toBe(false);
    expect(asksAboutSelection(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(asksAboutSelection(key({ ctrlKey: true }), false)).toBe(true);
    expect(asksAboutSelection(key({ metaKey: true }), false)).toBe(false);
    expect(asksAboutSelection(key({ key: "k", metaKey: true }), true)).toBe(false);
  });

  it("puts the pill above the selection, below it at the top edge, and inside the window", () => {
    const viewport = { width: 1000, height: 800 };
    expect(pillPlace({ top: 300, bottom: 320, left: 400, right: 600 }, viewport, 140)).toEqual({ top: 260, left: 430 });
    expect(pillPlace({ top: 20, bottom: 40, left: 400, right: 600 }, viewport, 140)).toEqual({ top: 48, left: 430 });
    expect(pillPlace({ top: 300, bottom: 320, left: 0, right: 20 }, viewport, 140)).toEqual({ top: 260, left: 8 });
    expect(pillPlace({ top: 300, bottom: 320, left: 980, right: 1000 }, viewport, 140)).toEqual({ top: 260, left: 852 });
    expect(pillPlace({ top: -200, bottom: -100, left: 400, right: 600 }, viewport, 140)).toBeNull();
  });
});
