import { useEffect, useRef, useState } from "react";

import { isBotTextRow } from "@/components/chat-bubble";
import type { Message } from "@/state/store";

/** Grok Bot shows "Typing…" at least this long before each bot bubble lands (ms). */
export const TYPING_MIN_MS = 500;

export interface TypingHoldState {
  /** rows already shown, or there before this chat was opened */
  known: Set<string>;
  /** when this client first saw each held bubble */
  heldAt: Map<string, number>;
  openedAt: number;
}

export interface TypingHold {
  /** the rows to draw now: everything before the first held bubble */
  rows: Message[];
  /** a bubble is held: the status line says "Typing…" */
  typing: boolean;
  /** when the hold next changes, or Infinity */
  wakeAt: number;
}

export function newTypingHold(messages: readonly Message[], now: number): TypingHoldState {
  return { known: new Set(messages.map((message) => message.id)), heldAt: new Map(), openedAt: now };
}

/** Which rows show now. A bot bubble that arrives while the chat is open waits until the status line has said "Typing…"
 * for TYPING_MIN_MS, as each of Grok Bot's bubbles does; the rows after it wait with it so the order holds. Once the turn
 * is over (`busy` false), the held rows land in the frame the line starts leaving, growing out of where it was. The person's own
 * words are never held back: a send while a bubble waits lets everything through at once. */
export function holdRows(messages: readonly Message[], state: TypingHoldState, { botId, busy, now, shownAlready }: { botId: string; busy: boolean; now: number; shownAlready?: (id: string) => boolean }): TypingHold {
  const release = (): TypingHold => {
    for (const message of messages) state.known.add(message.id);
    state.heldAt.clear();
    return { rows: messages as Message[], typing: false, wakeAt: Infinity };
  };
  for (;;) {
    const at = messages.findIndex((message) => !state.known.has(message.id) && message.at > state.openedAt - 2_000 && isBotTextRow(message, botId) && Boolean(message.text?.trim()) && !shownAlready?.(message.id));
    if (at < 0) return release();
    if (messages.slice(at).some((message) => message.role === "user")) return release();
    for (const message of messages.slice(0, at)) state.known.add(message.id);
    const held = messages[at]!;
    const since = state.heldAt.get(held.id) ?? now;
    state.heldAt.set(held.id, since);
    const typed = since + TYPING_MIN_MS;
    const rows = messages.slice(0, at);
    if (now < typed) return { rows, typing: true, wakeAt: typed };
    if (!busy) return release();
    // the bubble lands; the next one, if it came with it, gets its own typing beat from now
    state.heldAt.delete(held.id);
    const next = messages.findIndex((message, index) => index > at && isBotTextRow(message, botId));
    for (const message of messages.slice(at, next < 0 ? messages.length : next)) state.known.add(message.id);
  }
}

/** holdRows for one chat, waking when the hold changes. Rows are the given array itself whenever nothing is held. */
export function useTypingHold(key: string, messages: readonly Message[], botId: string, busy: boolean, shownAlready?: (id: string) => boolean): TypingHold {
  const [, wake] = useState(0);
  const state = useRef<{ key: string; hold: TypingHoldState } | null>(null);
  const cut = useRef<{ source: readonly Message[]; rows: Message[] } | null>(null);
  const now = Date.now();
  if (!state.current || state.current.key !== key) state.current = { key, hold: newTypingHold(messages, now) };
  const result = holdRows(messages, state.current.hold, { botId, busy, now, shownAlready });
  // the same cut of the same rows keeps its identity, so what derives from it does not re-run every render
  let rows = result.rows;
  if (rows !== messages) {
    const last = cut.current;
    if (last && last.source === messages && last.rows.length === rows.length) rows = last.rows;
    else cut.current = { source: messages, rows };
  }
  const { wakeAt } = result;
  useEffect(() => {
    if (!Number.isFinite(wakeAt)) return;
    const timer = setTimeout(() => wake((tick) => tick + 1), Math.max(0, wakeAt - Date.now()));
    return () => clearTimeout(timer);
  }, [wakeAt]);
  return { ...result, rows };
}
