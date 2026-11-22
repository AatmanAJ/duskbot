import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { TextQuote } from "../icons";

import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { requestQuote } from "@/lib/quote-selection";

const PILL_HEIGHT = 32;
const GAP = 8;
const EDGE = 8;
const HALF_WIDTH = 60;

export interface TranscriptSelection {
  text: string;
  rect: { top: number; bottom: number; left: number; right: number };
}

/** The text selected inside `root`'s messages, with where it sits on screen; none for a selection in a field or button,
 * or one that reaches outside `root`. */
export function transcriptSelection(root: HTMLElement | null, selection: Selection | null): TranscriptSelection | null {
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  if (!root.contains(common)) return null;
  const element = common instanceof Element ? common : common.parentElement;
  if (element?.closest("input, textarea, button, [contenteditable=true], [role=dialog]")) return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const { top, bottom, left, right } = range.getBoundingClientRect();
  return { text, rect: { top, bottom, left, right } };
}

/** Above the selection, or below it when the top of the window leaves no room; its middle kept `half` from the sides. */
export function pillPosition(rect: TranscriptSelection["rect"], half: number, viewport: { width: number }): { top: number; center: number } {
  const above = rect.top - GAP - PILL_HEIGHT;
  const top = above >= EDGE * 6 ? above : rect.bottom + GAP;
  const center = (rect.left + rect.right) / 2;
  return { top, center: Math.min(Math.max(center, half + EDGE), viewport.width - half - EDGE) };
}

const isQuoteChord = (event: KeyboardEvent) => (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "l";

/** A Quote pill over text selected in a conversation; it, or ⌘L / Ctrl+L, puts the text in that conversation's
 * message box as a quote. */
export function SelectionQuote({ root, threadId }: { root: RefObject<HTMLElement | null>; threadId: string }) {
  const [current, setCurrent] = useState<TranscriptSelection | null>(null);
  useEffect(() => {
    let pressing = false;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setCurrent(pressing ? null : transcriptSelection(root.current, document.getSelection())));
    };
    const down = (event: PointerEvent) => { if (event.button === 0 && root.current?.contains(event.target as Node)) pressing = true; };
    const up = () => { pressing = false; read(); };
    const quote = (event: KeyboardEvent) => {
      if (!isQuoteChord(event) || event.defaultPrevented) return;
      const selected = transcriptSelection(root.current, document.getSelection());
      if (!selected || !requestQuote(threadId, selected.text)) return;
      event.preventDefault();
      document.getSelection()?.removeAllRanges();
    };
    document.addEventListener("selectionchange", read);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("keydown", quote);
    window.addEventListener("scroll", read, true);
    window.addEventListener("resize", read);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("keydown", quote);
      window.removeEventListener("scroll", read, true);
      window.removeEventListener("resize", read);
    };
  }, [root, threadId]);
  if (!current) return null;
  const mac = isMacPlatform();
  const keys = mac ? "⌘L" : "Ctrl+L";
  const position = pillPosition(current.rect, HALF_WIDTH, { width: window.innerWidth });
  return createPortal(
    <button
      type="button"
      data-selection-quote=""
      aria-label={t("chat.quoteSelection.aria")}
      aria-keyshortcuts={mac ? "Meta+L" : "Control+L"}
      title={`${t("chat.quoteSelection.aria")} (${keys})`}
      style={{ top: position.top, left: position.center, height: PILL_HEIGHT }}
      // Keeps the selection alive until the click reads it.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        if (requestQuote(threadId, current.text)) document.getSelection()?.removeAllRanges();
        setCurrent(null);
      }}
      className="fixed z-50 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-composer px-3 text-[13px] font-medium text-ink shadow-lg ring-1 ring-transparent hover:bg-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <TextQuote size={14} aria-hidden="true" />
      <span>{t("chat.quoteSelection")}</span>
      <kbd className="font-sans text-[12px] text-ink-tertiary">{keys}</kbd>
    </button>,
    document.body,
  );
}
