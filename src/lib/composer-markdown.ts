/** One replacement in the message box: `text.slice(from, to)` becomes `insert`, and the caret lands on `caret`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  caret: number;
}

export type MarkdownKey = "newline" | "indent" | "outdent" | "backspace";

const INDENT = "  ";
const LIST_ITEM = /^( *)(?:([-*])|(\d{1,9})([.)])) /;
const QUOTE_LINE = /^( *)> ?/;
const FENCE = /^ *```/;

interface Marker {
  indent: string;
  /** The marker with its space, after the indent. */
  mark: string;
  quote: boolean;
  next: string;
}

function markerOf(line: string): Marker | null {
  const item = LIST_ITEM.exec(line);
  if (item) {
    const [whole, indent = "", bullet, number, delimiter] = item;
    const next = bullet ? `${bullet} ` : `${Number(number) + 1}${delimiter} `;
    return { indent, mark: whole.slice(indent.length), quote: false, next };
  }
  const quote = QUOTE_LINE.exec(line);
  if (quote) {
    const [whole, indent = ""] = quote;
    return { indent, mark: whole.slice(indent.length), quote: true, next: "> " };
  }
  return null;
}

function lineAround(text: string, at: number): { start: number; end: number; line: string } {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const newline = text.indexOf("\n", at);
  const end = newline < 0 ? text.length : newline;
  return { start, end, line: text.slice(start, end) };
}

function insideCodeFence(text: string, lineStart: number): boolean {
  return text.slice(0, lineStart).split("\n").filter((line) => FENCE.test(line)).length % 2 === 1;
}

function outdented(start: number, marker: Marker, caret: number): TextEdit | null {
  if (!marker.indent) return null;
  const cut = Math.min(INDENT.length, marker.indent.length);
  return { from: start, to: start + cut, insert: "", caret: Math.max(start, caret - cut) };
}

/** What a key does on a list or quote line of the message box, or null to let the key do what it always does. */
export function markdownKeyEdit(text: string, selectionStart: number, selectionEnd: number, key: MarkdownKey): TextEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const caret = selectionStart;
  const { start, end, line } = lineAround(text, caret);
  if (insideCodeFence(text, start)) return null;
  const marker = markerOf(line);
  if (!marker) return null;
  const contentStart = start + marker.indent.length + marker.mark.length;
  const empty = !line.slice(contentStart - start).trim();
  switch (key) {
    case "newline": {
      if (caret < contentStart) return null;
      if (empty) {
        return outdented(start, marker, caret) ?? { from: start, to: end, insert: "", caret: start };
      }
      const insert = `\n${marker.indent}${marker.next}`;
      return { from: caret, to: caret, insert, caret: caret + insert.length };
    }
    case "indent": {
      if (marker.quote) return null;
      const renumbered = /^\d/.test(marker.mark) ? marker.mark.replace(/^\d+/, "1") : marker.mark;
      const from = start + marker.indent.length;
      const insert = `${INDENT}${renumbered}`;
      return { from, to: contentStart, insert, caret: caret <= from ? caret : caret + insert.length - marker.mark.length };
    }
    case "outdent":
      return marker.quote ? null : outdented(start, marker, caret);
    case "backspace": {
      if (caret !== contentStart) return null;
      if (marker.quote || !marker.indent) return { from: start + marker.indent.length, to: contentStart, insert: "", caret: start + marker.indent.length };
      return outdented(start, marker, caret);
    }
  }
}

/** The key's meaning here, given whether its Enter would send the message instead. */
export function markdownKeyOf(event: Pick<KeyboardEvent, "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">, enterSends: boolean): MarkdownKey | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "Enter") return enterSends ? null : "newline";
  if (event.key === "Tab") return event.shiftKey ? "outdent" : "indent";
  if (event.key === "Backspace" && !event.shiftKey) return "backspace";
  return null;
}

/** Applies `edit` as typing would, so the browser's own undo takes it back. */
export function applyTextEdit(field: HTMLTextAreaElement, edit: TextEdit): void {
  field.focus();
  field.setSelectionRange(edit.from, edit.to);
  const typed = edit.insert ? document.execCommand("insertText", false, edit.insert) : document.execCommand("delete");
  if (!typed) {
    field.setRangeText(edit.insert, edit.from, edit.to, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  field.setSelectionRange(edit.caret, edit.caret);
}
