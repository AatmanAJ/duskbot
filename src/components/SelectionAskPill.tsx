import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { TextQuote } from "../icons";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { quotableSelection } from "@/lib/selection-quote";

const PILL_HEIGHT = 32;
const GAP = 8;
const EDGE = 8;

/** ⌘L on a Mac, Ctrl+L elsewhere, with no other modifier. */
export function asksAboutSelection(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, mac: boolean = isMacPlatform()): boolean {
  if (event.key.toLowerCase() !== "l" || event.shiftKey || event.altKey) return false;
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Where the pill sits: above the selection's first line, or below it when there is no room above. */
export function pillPlace(
  selection: Pick<DOMRect, "top" | "bottom" | "left" | "right">,
  viewport: { width: number; height: number },
  pillWidth: number,
): { top: number; left: number } | null {
  if (selection.bottom < 0 || selection.top > viewport.height) return null;
  const above = selection.top - GAP - PILL_HEIGHT;
  const top = above >= EDGE ? above : Math.min(selection.bottom + GAP, viewport.height - EDGE - PILL_HEIGHT);
  const center = (selection.left + selection.right) / 2;
  const left = Math.max(EDGE, Math.min(center - pillWidth / 2, viewport.width - EDGE - pillWidth));
  return { top: Math.round(top), left: Math.round(left) };
}

/** "Ask about this" beside words selected in a message: it hands them to `onAsk` and clears the selection. */
export function SelectionAskPill({ onAsk, enabled = true }: { onAsk: (text: string) => void; enabled?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const ask = useRef(onAsk);
  ask.current = onAsk;
  const mac = isMacPlatform();
  const quote = () => {
    const picked = quotableSelection(window.getSelection());
    if (!picked) return false;
    ask.current(picked.text);
    window.getSelection()?.removeAllRanges();
    setPlace(null);
    return true;
  };
  const quoteRef = useRef(quote);
  quoteRef.current = quote;

  useEffect(() => {
    setMounted(true);
    if (!enabled) return;
    let pressing = false;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const picked = quotableSelection(window.getSelection());
      if (!picked) { setPlace(null); return; }
      const first = picked.range.getClientRects()[0] ?? picked.range.getBoundingClientRect();
      const box = picked.range.getBoundingClientRect();
      const width = pillRef.current?.offsetWidth || 150;
      setPlace(pillPlace({ top: first.top, bottom: box.bottom, left: box.left, right: box.right }, { width: window.innerWidth, height: window.innerHeight }, width));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && pillRef.current?.contains(event.target)) return;
      pressing = true;
      setPlace(null);
    };
    const onPointerUp = () => { pressing = false; schedule(); };
    const onSelection = () => { if (!pressing) schedule(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (asksAboutSelection(event, mac)) {
        if (quoteRef.current()) event.preventDefault();
      } else if (event.key === "Escape") setPlace(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.addEventListener("keydown", onKey);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, mac]);

  if (!enabled || !mounted) return null;
  const shortcut = mac ? "⌘L" : "Ctrl+L";
  return createPortal(
    <button
      ref={pillRef}
      type="button"
      data-selection-ask=""
      aria-hidden={place ? undefined : true}
      tabIndex={place ? 0 : -1}
      title={`${t("chat.selection.ask")} (${shortcut})`}
      // a press would otherwise clear the selection it quotes
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => quoteRef.current()}
      style={place ? { top: place.top, left: place.left } : { top: -9999, left: -9999 }}
      className={place
        ? "fixed z-[70] inline-flex h-8 items-center gap-1.5 rounded-full bg-menu ps-3 pe-2.5 text-[13px] font-medium leading-4 text-ink shadow-(--shadow-popover) animate-pop-in hover:bg-menu-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        : "pointer-events-none invisible fixed inline-flex h-8 items-center gap-1.5 ps-3 pe-2.5 text-[13px] font-medium leading-4"}
    >
      <TextQuote size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <span>{t("chat.selection.ask")}</span>
      <kbd className="ms-0.5 font-sans text-[12px] font-normal text-ink-tertiary">{shortcut}</kbd>
    </button>,
    document.body,
  );
}
