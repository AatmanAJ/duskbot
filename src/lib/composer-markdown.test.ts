import { describe, expect, it } from "vitest";

import { markdownKeyEdit, markdownKeyOf, type MarkdownKey, type TextEdit } from "./composer-markdown";

/** Runs a key with the caret where `|` is, and returns the text with the caret drawn back in, or null. */
function press(marked: string, key: MarkdownKey): string | null {
  const at = marked.indexOf("|");
  const text = marked.replace("|", "");
  const edit: TextEdit | null = markdownKeyEdit(text, at, at, key);
  if (!edit) return null;
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  return `${next.slice(0, edit.caret)}|${next.slice(edit.caret)}`;
}

describe("lists and quotes in the message box", () => {
  it("continues a bulleted, numbered or quoted line on a new line", () => {
    expect(press("- milk|", "newline")).toBe("- milk\n- |");
    expect(press("* eggs|", "newline")).toBe("* eggs\n* |");
    expect(press("Shopping:\n9. bread|", "newline")).toBe("Shopping:\n9. bread\n10. |");
    expect(press("1) first|", "newline")).toBe("1) first\n2) |");
    expect(press("> as you said|", "newline")).toBe("> as you said\n> |");
    expect(press("  - nested|", "newline")).toBe("  - nested\n  - |");
  });

  it("splits an item where the caret is", () => {
    expect(press("- milk| and eggs", "newline")).toBe("- milk\n- | and eggs");
  });

  it("ends the list on an empty item, and steps a nested empty item out first", () => {
    expect(press("- milk\n- |", "newline")).toBe("- milk\n|");
    expect(press("> quoted\n> |", "newline")).toBe("> quoted\n|");
    expect(press("- milk\n  - |", "newline")).toBe("- milk\n- |");
  });

  it("leaves plain lines, the marker itself and fenced code alone", () => {
    expect(press("just text|", "newline")).toBeNull();
    expect(press("-|", "newline")).toBeNull();
    expect(press("|- milk", "newline")).toBeNull();
    expect(press("-not a list|", "newline")).toBeNull();
    expect(press("```yaml\n- key: value|", "newline")).toBeNull();
    expect(press("```\ncode\n```\n- after|", "newline")).toBe("```\ncode\n```\n- after\n- |");
  });

  it("nests and un-nests list items with Tab and Shift+Tab, a nested number starting at 1", () => {
    expect(press("- milk\n- eggs|", "indent")).toBe("- milk\n  - eggs|");
    expect(press("1. one\n2. two|", "indent")).toBe("1. one\n  1. two|");
    expect(press("1. one\n10. |", "indent")).toBe("1. one\n  1. |");
    expect(press("|- milk", "indent")).toBe("|  - milk");
    expect(press("- milk\n  - eggs|", "outdent")).toBe("- milk\n- eggs|");
    expect(press("- top|", "outdent")).toBeNull();
    expect(press("> quoted|", "indent")).toBeNull();
    expect(press("plain|", "indent")).toBeNull();
  });

  it("lifts a line out with Backspace right after its marker", () => {
    expect(press("- |milk", "backspace")).toBe("|milk");
    expect(press("> |quoted", "backspace")).toBe("|quoted");
    expect(press("  - |milk", "backspace")).toBe("- |milk");
    expect(press("- m|ilk", "backspace")).toBeNull();
    expect(press("plain|", "backspace")).toBeNull();
  });

  it("does nothing over a selection", () => {
    expect(markdownKeyEdit("- milk", 2, 6, "newline")).toBeNull();
  });
});

describe("which keys count", () => {
  const key = (init: Partial<KeyboardEvent>) => ({ key: "Enter", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...init });

  it("treats Enter as a new line only when it would not send", () => {
    expect(markdownKeyOf(key({}), true)).toBeNull();
    expect(markdownKeyOf(key({ shiftKey: true }), false)).toBe("newline");
    expect(markdownKeyOf(key({ metaKey: true }), false)).toBeNull();
    expect(markdownKeyOf(key({ altKey: true }), false)).toBeNull();
  });

  it("reads Tab, Shift+Tab and Backspace", () => {
    expect(markdownKeyOf(key({ key: "Tab" }), false)).toBe("indent");
    expect(markdownKeyOf(key({ key: "Tab", shiftKey: true }), false)).toBe("outdent");
    expect(markdownKeyOf(key({ key: "Backspace" }), false)).toBe("backspace");
    expect(markdownKeyOf(key({ key: "a" }), false)).toBeNull();
  });
});
