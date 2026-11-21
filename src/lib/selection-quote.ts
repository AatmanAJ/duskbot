import { useSyncExternalStore } from "react";

/** The part of a message a person asked about, held per draft until it is sent or removed. */
const quotes = new Map<string, string>();
const listeners = new Set<() => void>();

export function setSelectionQuote(draftId: string, quote: string | null): void {
  const clean = quote ? cleanSelectionText(quote) : "";
  if (clean) quotes.set(draftId, clean);
  else quotes.delete(draftId);
  for (const listener of listeners) listener();
}

export function selectionQuoteFor(draftId: string): string | null {
  return quotes.get(draftId) ?? null;
}

export function useSelectionQuote(draftId: string): string | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => selectionQuoteFor(draftId),
    () => null,
  );
}

export function cleanSelectionText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The quote as a Markdown block quote ahead of what the person wrote, so the bot reads which words they mean. */
export function withSelectionQuote(quote: string | null, body: string): string {
  const clean = quote ? cleanSelectionText(quote) : "";
  if (!clean) return body;
  const block = clean.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
  return body ? `${block}\n\n${body}` : block;
}

/** A sent message that opens with a block quote: the quoted words and the rest, to show the quote as its own block. */
export function splitSelectionQuote(text: string): { quote: string; rest: string } | null {
  const match = /^((?:>[^\n]*(?:\n|$))+)(?:\n+)?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const quote = match[1]!.split("\n").map((line) => line.replace(/^> ?/, "")).join("\n").trim();
  return quote ? { quote, rest: match[2]!.trim() } : null;
}

const QUOTABLE = "[data-quotable]";
const NOT_QUOTABLE = "textarea, input, [contenteditable=''], [contenteditable='true'], [data-tour='composer']";

function elementOf(node: Node | null): Element | null {
  return !node ? null : node instanceof Element ? node : node.parentElement;
}

/** The selected words when the selection starts and ends in a message the person may ask about, else null. */
export function quotableSelection(selection: Selection | null): { text: string; range: Range } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const ends = [elementOf(selection.anchorNode), elementOf(selection.focusNode)];
  if (ends.some((end) => !end?.closest(QUOTABLE) || end.closest(NOT_QUOTABLE))) return null;
  const text = cleanSelectionText(selection.toString());
  return text ? { text, range: selection.getRangeAt(0) } : null;
}
