import { useEffect, useLayoutEffect, useRef } from "react";

export const QUOTE_MAX_CHARS = 4000;
const QUOTE_LINE = /^> ?/;

/** Selected text as a Markdown block quote: trailing spaces and outer blank lines dropped, blank runs kept to one. */
export function quoteBlock(selected: string): string {
  let text = selected.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n")
    .replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  if (!text.trim()) return "";
  if (text.length > QUOTE_MAX_CHARS) text = `${text.slice(0, QUOTE_MAX_CHARS).trimEnd()}…`;
  return text.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
}

/** The draft with the quote after what is already written, and a blank line below it to answer on. */
export function withQuote(draft: string, selected: string): string {
  const block = quoteBlock(selected);
  if (!block) return draft;
  const head = draft.replace(/\s+$/, "");
  return head ? `${head}\n\n${block}\n\n` : `${block}\n\n`;
}

export type QuotedRun = { quote: boolean; text: string };

/** A sent message cut into runs of quoted lines (`> `, shown without the marker) and plain lines. */
export function quotedRuns(text: string): QuotedRun[] {
  const runs: QuotedRun[] = [];
  for (const line of text.split("\n")) {
    const quote = QUOTE_LINE.test(line);
    const body = quote ? line.replace(QUOTE_LINE, "") : line;
    const last = runs.at(-1);
    if (last && last.quote === quote) last.text += `\n${body}`;
    else runs.push({ quote, text: body });
  }
  return runs;
}

export function hasQuotedLines(text: string): boolean {
  return text.split("\n").some((line) => QUOTE_LINE.test(line));
}

const listeners = new Map<string, Set<(selected: string) => void>>();

/** Sends `selected` to the message box of the conversation `threadId`; false when none is open to take it. */
export function requestQuote(threadId: string, selected: string): boolean {
  const open = listeners.get(threadId);
  if (!open?.size || !quoteBlock(selected)) return false;
  for (const listener of open) listener(selected);
  return true;
}

export function useQuoteRequests(threadId: string, onQuote: (selected: string) => void): void {
  const latest = useRef(onQuote);
  useLayoutEffect(() => { latest.current = onQuote; });
  useEffect(() => {
    if (!threadId) return;
    const listener = (selected: string) => latest.current(selected);
    const open = listeners.get(threadId) ?? new Set();
    open.add(listener);
    listeners.set(threadId, open);
    return () => {
      open.delete(listener);
      if (!open.size) listeners.delete(threadId);
    };
  }, [threadId]);
}
