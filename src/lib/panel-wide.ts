import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import { reducedMotion } from "./onboarding";

/** The bot panel's usual width. */
export const PANEL_NARROW = 320;
/** The chat keeps at least this much beside a widened panel. */
const CHAT_KEEPS = 400;
const WIDE_MAX = 880;

let width = PANEL_NARROW;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => width;

/** The panel's width now: PANEL_NARROW, or wider while the browser in it is expanded. */
export function usePanelWidth(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function panelWide(): boolean {
  return width > PANEL_NARROW;
}

/** About 60% of the room the chat and panel share, never squeezing the chat under CHAT_KEEPS. */
export function wideWidth(shared: number): number {
  return Math.round(Math.max(PANEL_NARROW, Math.min(WIDE_MAX, shared * 0.6, shared - CHAT_KEEPS)));
}

/** The room the chat and a docked panel share; a panel over the chat (a narrow window) has the window's. */
function sharedRoom(): number {
  const slot = document.querySelector<HTMLElement>("[data-panel-slot]");
  const chat = slot?.parentElement?.querySelector<HTMLElement>(":scope > main");
  if (slot && chat) return slot.getBoundingClientRect().right - chat.getBoundingClientRect().left;
  return window.innerWidth - 48;
}

function apply(next: number): void {
  if (next === width) return;
  width = next;
  document.documentElement.style.setProperty("--side-panel-w", `${next}px`);
  for (const listener of listeners) listener();
}

function onResize(): void {
  if (panelWide()) apply(wideWidth(sharedRoom()));
}

/** Widens the panel beside the chat, or brings it back. The chat and panel move as one spring through a view transition,
 * snapshots only, so the live page never lays out mid-motion; with less motion it simply changes. */
export function setPanelWide(on: boolean): void {
  const next = on ? wideWidth(sharedRoom()) : PANEL_NARROW;
  if (next === width) return;
  if (on) window.addEventListener("resize", onResize);
  else window.removeEventListener("resize", onResize);
  const root = document.documentElement;
  if (reducedMotion() || typeof document.startViewTransition !== "function") { apply(next); return; }
  root.classList.add("panel-widening");
  const transition = document.startViewTransition(() => flushSync(() => apply(next)));
  void transition.finished.finally(() => root.classList.remove("panel-widening"));
}
