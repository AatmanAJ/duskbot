import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { MentionPeer } from "@/lib/mentions";
import { closeOpenMarks, nextReveal, noteRevealed, wordCount } from "@/lib/text-reveal";
import { shownReplyText, useLiveReplyText } from "@/state/live-reply";
import { usePrefersReducedMotion } from "./mascot-clock";
import { ChatMarkdown } from "./ChatMarkdown";
import { SIMPLE_BOT_BUBBLE, SIMPLE_BUBBLE_MAX } from "./chat-bubble";
import { MESSAGE_ROW } from "./MessageActions";

const FRAME_MS = 48;
const ACTIONS_FALLBACK_PX = 112;
const LIVE_REVEAL = { from: 0, step: 0 };

/** The reply as it streams, in the bubble it will land in: the text is paced (src/lib/text-reveal.ts) so uneven
 * chunks read as a steady flow of words, each fading in. The landed message takes over from what this showed. */
export function LiveReplyBubble({ threadId, mentionPeers, onGrow }: {
  threadId: string;
  mentionPeers?: readonly MentionPeer[];
  /** The bubble grew by this many px (a new line): the transcript glides up by as much. */
  onGrow?: (px: number) => void;
}) {
  const target = shownReplyText(useLiveReplyText(threadId));
  const reduced = usePrefersReducedMotion();
  const [chars, setChars] = useState(0);
  const shown = useRef({ chars: 0, target });
  shown.current.target = target;
  const behind = !reduced && chars < target.length;

  useEffect(() => {
    if (!behind) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (now - last >= FRAME_MS) {
        const next = nextReveal(shown.current.target, shown.current.chars, now - last);
        last = now;
        if (next !== shown.current.chars) { shown.current.chars = next; setChars(next); }
        if (next >= shown.current.target.length) return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [behind]);

  const text = reduced ? target : target.slice(0, Math.min(chars, target.length));
  useEffect(() => { noteRevealed(threadId, wordCount(text)); }, [threadId, text]);

  const visible = Boolean(text.trim());
  const bubble = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const grow = useRef(onGrow);
  grow.current = onGrow;
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const next = el.offsetHeight;
      const by = next - height.current;
      if (height.current && by > 0) grow.current?.(by);
      height.current = next;
    });
    observer.observe(el);
    return () => { observer.disconnect(); height.current = 0; };
  }, [visible]);

  // the landed reply's row keeps room for its actions beside the bubble; the same room here makes the lines wrap where
  // they will land, so nothing re-wraps at the handoff
  const [actions, setActions] = useState(ACTIONS_FALLBACK_PX);
  useLayoutEffect(() => {
    if (!visible) return;
    const row = bubble.current?.closest("[data-simple-rows]")?.querySelectorAll<HTMLElement>(`[${MESSAGE_ROW}].items-start [data-testid="message-actions"]`);
    const width = row?.length ? row[row.length - 1]!.offsetWidth : 0;
    if (width) setActions(width);
  }, [visible]);

  if (!visible) return null;
  return (
    <div data-live-reply="" className="relative flex w-full flex-col items-start" aria-hidden="true">
      <div className="flex w-full items-center justify-start gap-1.5">
        <div ref={bubble} data-chat-bubble="simple" className={cn("w-fit", SIMPLE_BUBBLE_MAX, SIMPLE_BOT_BUBBLE)}>
          <ChatMarkdown text={closeOpenMarks(text)} mentionPeers={mentionPeers} reveal={reduced ? undefined : LIVE_REVEAL} />
        </div>
        <span className="shrink-0" style={{ width: actions }} />
      </div>
    </div>
  );
}
