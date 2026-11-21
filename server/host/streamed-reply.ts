// A person's Stop keeps the words already streamed and nothing after: each thread's reply text since its last finished
// item, and that text frozen at the first frame after the Stop (landed as the turn's last bubble, then cleared). A direct
// "(pass)" is held back while it streams and never lands, and a turn that only passed ends quietly.
import type { Message } from "../store.ts";
import { assistantTranscript } from "../../shared/client-cancel.ts";
import { isPassText } from "../room-reply.ts";
import { isDirectPassText, PassStreamGate } from "../silent-reply.ts";

interface StreamedReplyDeps {
  messagesFor(threadId: string): Message[];
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): unknown;
  /** True for a room's thread, where a member's "(pass)" is its choice to stay quiet. */
  inRoom(threadId: string): boolean;
  directPassAllowed(threadId: string): boolean;
}

type ReplyEvent = { type: "content.delta"; threadId: string; delta: string } | { type: "item.completed"; threadId: string; text: string };

const flatWords = (text: string) => text.replace(/\s+/g, " ").trim();
const OUTPUT_KINDS = new Set<Message["kind"]>(["text", "widget", "app", "options", "screen"]);

/** A turn showed the person something: a reply, or a bot row of its own since it started. */
export function turnHadOutput(path: readonly Message[], reply: string, turnId: string | undefined, startedAt: number | undefined): boolean {
  return Boolean(reply) || path.some((message) => message.role === "bot" && OUTPUT_KINDS.has(message.kind)
    && ((turnId && message.turnId === turnId) || (startedAt !== undefined && message.at >= startedAt)));
}

export function createStreamedReply(deps: StreamedReplyDeps) {
  const streamed = new Map<string, string>(), atStop = new Map<string, string>();
  /** The streaming reply's words the person's app showed when they pressed Stop: what is kept ends there. */
  const saidAtStop = new Map<string, string>();
  const passGate = new PassStreamGate(), silentPass = new Set<string>();

  const keptAtStop = (threadId: string, turnId: string | undefined) => {
    const text = streamed.get(threadId) ?? "";
    const said = saidAtStop.get(threadId);
    if (said === undefined) return text;
    // the item they watched is still streaming: keep exactly what they saw
    if (flatWords(text).startsWith(flatWords(said))) return said;
    // it finished on its way to the Stop: its bubble ends where they stopped seeing it, and nothing after is kept
    const bubble = deps.messagesFor(threadId).findLast((message) => message.role === "bot" && message.kind === "text" && message.turnId === turnId);
    const landed = flatWords(bubble?.text ?? "");
    if (bubble && landed !== flatWords(said) && landed.startsWith(flatWords(said))) deps.patchMessage(threadId, bubble.id, { text: said });
    return "";
  };
  const clear = (threadId: string) => { streamed.delete(threadId); atStop.delete(threadId); saidAtStop.delete(threadId); passGate.reset(threadId); };

  return {
    saidAtStop: (threadId: string, said: string) => saidAtStop.set(threadId, said),
    turnStarted: (threadId: string) => { clear(threadId); silentPass.delete(threadId); },
    /** Reply words as they arrive: the delta the apps may see (null while it could still spell "(pass)"), and whether a
     * finished item is a pass that never shows. */
    onReply(event: ReplyEvent, turnId: string | undefined, afterPersonStop: boolean): { delta?: string | null; passItem: boolean } {
      const { threadId } = event;
      if (afterPersonStop) {
        if (!atStop.has(threadId)) { passGate.reset(threadId); atStop.set(threadId, keptAtStop(threadId, turnId)); }
        return { passItem: false };
      }
      if (event.type === "content.delta") {
        const delta = passGate.delta(threadId, event.delta);
        if (delta !== null) streamed.set(threadId, (streamed.get(threadId) ?? "") + delta);
        return { delta, passItem: false };
      }
      passGate.reset(threadId);
      streamed.delete(threadId);
      const spoken = assistantTranscript(event.text);
      if (spoken.kind === "stopped") return { passItem: false };
      return { passItem: deps.inRoom(threadId) ? Boolean(spoken.text.trim()) && isPassText(spoken.text) : deps.directPassAllowed(threadId) && isDirectPassText(spoken.text) };
    },
    /** The half answer that streamed before the Stop, handed out once. */
    takeKept(threadId: string) { const kept = atStop.get(threadId) ?? ""; atStop.set(threadId, ""); return kept; },
    /** At the end of a stopped turn: what it still has to settle as a bubble. */
    keptAtEnd: (threadId: string, turnId: string | undefined) => atStop.get(threadId) ?? keptAtStop(threadId, turnId),
    turnEnded: clear,
    passed: (threadId: string) => silentPass.add(threadId),
    spoke: (threadId: string) => silentPass.delete(threadId),
    /** Whether the turn only passed; asked once, at its end. */
    takePassed: (threadId: string) => silentPass.delete(threadId),
  };
}
