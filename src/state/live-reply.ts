// The reply text a thread's engine is streaming right now, held outside the app reducer like the status line, so a
// delta re-renders only the one row that shows it. It stays until the reply's message lands in the transcript.
import { useSyncExternalStore } from "react";

import type { RuntimeEvent } from "../../shared/runtime-events";
import { redactSecretsInText } from "../../shared/redact";

export interface LiveReply {
  text: string;
  startedAt: number;
  /** The person pressed Stop: the text stays as it was at the press, and nothing more streams into it. */
  cut?: boolean;
}

const MAX_THREADS = 200;
const MAX_STREAMED = 200;
/** A turn that ended without its message (stopped, failed) lets its streamed text go after this long. */
export const LIVE_REPLY_ORPHAN_MS = 1_500;

const replies = new Map<string, LiveReply>();
const listeners = new Map<string, Set<() => void>>();
const orphanTimers = new Map<string, ReturnType<typeof setTimeout>>();
const streamed = new Set<string>();

const anyListeners = new Set<() => void>();

function notify(threadId: string): void {
  for (const listener of Array.from(listeners.get(threadId) ?? [])) listener();
  for (const listener of Array.from(anyListeners)) listener();
}

/** Any thread's streaming reply changed (the island and the dock show it as it streams: src/ambient/AmbientPublisher). */
export function onAnyLiveReply(listener: () => void): () => void {
  anyListeners.add(listener);
  return () => { anyListeners.delete(listener); };
}

function cancelOrphan(threadId: string): void {
  const timer = orphanTimers.get(threadId);
  if (timer) clearTimeout(timer);
  orphanTimers.delete(threadId);
}

function clear(threadId: string): void {
  cancelOrphan(threadId);
  if (!replies.delete(threadId)) return;
  notify(threadId);
}

export function noteReplyEvent(event: RuntimeEvent, now = Date.now()): void {
  const { threadId } = event;
  switch (event.type) {
    case "content.delta": {
      if (event.streamKind !== "assistant_text" || !event.delta) return;
      const current = replies.get(threadId);
      if (current?.cut) return;
      cancelOrphan(threadId);
      replies.delete(threadId);
      replies.set(threadId, { text: (current?.text ?? "") + event.delta, startedAt: current?.startedAt ?? now });
      if (replies.size > MAX_THREADS) {
        const oldest = replies.keys().next().value!;
        replies.delete(oldest);
        notify(oldest);
      }
      notify(threadId);
      return;
    }
    case "turn.started":
      clear(threadId);
      return;
    case "turn.completed":
    case "cap.exhausted":
    case "session.exited":
      if (!replies.has(threadId)) return;
      cancelOrphan(threadId);
      orphanTimers.set(threadId, setTimeout(() => clear(threadId), LIVE_REPLY_ORPHAN_MS));
      return;
    default:
  }
}

/** Stop was pressed: what streamed so far stays, and the stopped turn's later words never join it. A turn that streamed
 * nothing yet gets an empty cut reply, so its first words are dropped too. */
export function cutLiveReply(threadId: string, now = Date.now()): void {
  const current = replies.get(threadId);
  if (current?.cut) return;
  replies.set(threadId, { text: current?.text ?? "", startedAt: current?.startedAt ?? now, cut: true });
  notify(threadId);
}

/** A bot's words landed in the thread: they replace whatever was streaming there. */
export function noteReplyLanded(threadId: string, messageId: string): void {
  // a stopped turn's last words: the cut holds until the next turn starts, and the bubble that settles what streamed
  // takes the place of the one the Stop drew, without an entrance
  if (replies.get(threadId)?.cut) {
    if (replies.get(threadId)!.text) streamed.add(messageId);
    return;
  }
  if (replies.get(threadId)?.text) {
    streamed.add(messageId);
    if (streamed.size > MAX_STREAMED) streamed.delete(streamed.values().next().value!);
  }
  clear(threadId);
}

/** The message took the place of a reply that was already on screen, so it arrives without an entrance. */
export function replacedLiveReply(messageId: string): boolean {
  return streamed.has(messageId);
}

export function liveReply(threadId: string | null | undefined): LiveReply | null {
  return (threadId && replies.get(threadId)) || null;
}

function subscribe(threadId: string | null | undefined, listener: () => void): () => void {
  if (!threadId) return () => {};
  let set = listeners.get(threadId);
  if (!set) listeners.set(threadId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(threadId);
  };
}

const liveActive = (threadId: string | null | undefined) => {
  const reply = liveReply(threadId);
  return Boolean(reply?.text && !reply.cut);
};

/** Whether the thread is streaming a reply, for a parent that must not re-render on every delta. */
export function useLiveReplyActive(threadId: string | null | undefined): boolean {
  return useSyncExternalStore(
    (listener) => subscribe(threadId, listener),
    () => liveActive(threadId),
    () => liveActive(threadId),
  );
}

/** What a streaming reply may show: secrets masked as the stored message masks them, and a private key that has
 * begun but not ended held back whole. */
export function shownReplyText(text: string): string {
  const redacted = redactSecretsInText(text);
  for (const match of redacted.matchAll(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g)) {
    const body = redacted.slice(match.index + match[0].length);
    if (!/-----END [A-Z ]*PRIVATE KEY-----/.test(body)) return redacted.slice(0, match.index);
  }
  return redacted;
}

/** The live stream restarted without the frames it missed: the reply may have landed or its turn ended unseen, so
 * nothing streamed before reads as still streaming. */
export function forgetLiveReplies(): void {
  for (const threadId of Array.from(replies.keys())) clear(threadId);
}

/** Tests only. */
export function resetLiveReplies(): void {
  for (const timer of orphanTimers.values()) clearTimeout(timer);
  orphanTimers.clear();
  replies.clear();
  streamed.clear();
}

const liveText = (threadId: string | null | undefined) => {
  const reply = liveReply(threadId);
  return reply && !reply.cut ? reply.text : "";
};

/** The thread's streaming reply text, re-rendering on each delta: for the one row that draws it. */
export function useLiveReplyText(threadId: string | null | undefined): string {
  return useSyncExternalStore(
    (listener) => subscribe(threadId, listener),
    () => liveText(threadId),
    () => liveText(threadId),
  );
}
