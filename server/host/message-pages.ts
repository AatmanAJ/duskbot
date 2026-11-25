import type { Message, Store } from "../store.ts";
import { toolResultPrefix } from "../tool-results.ts";

const MESSAGE_PAGE_MAX = 200;
/** How much of a tool step's output a conversation page carries: the rest is fetched when the step is opened, so
 * switching to a conversation full of tool steps stays light. */
export const TOOL_OUTPUT_PREVIEW = 1_000;

/** undefined = absent, null = present but unusable (the caller answers 400). */
export function pageSize(raw: string | null): number | null | undefined {
  if (raw === null) return undefined;
  const size = Number(raw);
  if (!Number.isInteger(size) || size < 0) return null;
  return Math.min(size, MESSAGE_PAGE_MAX);
}

/** A message as clients see it: a screen without its image, and a person's message without the open-item ledger's state,
 * which is the bot's bookkeeping and changes after the send was answered. */
export function slimMessage(message: Message): Message | Record<string, unknown> {
  const { ask: _ask, ...shown } = message;
  if (shown.kind !== "screen" || !shown.png) return message.ask ? shown : message;
  const { png: _png, ...rest } = shown;
  return { ...rest, hasImage: true };
}

/** A message as a conversation page carries it: slimmed, and a plain tool step's long output cut to a preview marked
 * `clipped`. Input stays whole (labels parse it), and so do rows whose tool output is the reply itself (a teammate's
 * result, a relayed message, a handoff). */
export function pageMessage(message: Message): Message | Record<string, unknown> {
  const slim = slimMessage(message);
  const tool = message.tool;
  if (!tool || message.kind !== "activity" || message.relay || message.roomRequest || message.comm || message.threadRef) return slim;
  const output = tool.output;
  if (output === undefined || output.length <= TOOL_OUTPUT_PREVIEW) return slim;
  return { ...slim, tool: { ...tool, output: toolResultPrefix(output, TOOL_OUTPUT_PREVIEW), clipped: true } };
}

/** A conversation's messages one page at a time (newest first when `before` is absent), and the page around one message. */
export function messagePages(store: Pick<Store, "messagesFor" | "messagesTail" | "messagesBefore" | "activeLeaf" | "withMediaSizes">) {
  function messagePage(threadId: string, limit: number | undefined) {
    if (limit === undefined) {
      return { messages: store.withMediaSizes(threadId, store.messagesFor(threadId)), activeLeafId: store.activeLeaf(threadId) };
    }
    const tail = store.messagesTail(threadId, limit);
    return { messages: store.withMediaSizes(threadId, tail.messages).map(pageMessage), hasMore: tail.hasMore, activeLeafId: tail.activeLeafId };
  }

  /** The page before `before`; null when the conversation holds no such message. */
  function olderPage(threadId: string, limit: number, before: string) {
    const page = store.messagesBefore(threadId, before, limit);
    return page && { messages: store.withMediaSizes(threadId, page.messages).map(pageMessage), hasMore: page.hasMore, activeLeafId: page.activeLeafId };
  }

  function messageWindow(threadId: string, messageId: string, limit: number) {
    const all = store.messagesFor(threadId);
    const index = all.findIndex((message) => message.id === messageId);
    if (index < 0) return null;
    const before = Math.floor((limit - 1) / 2);
    const start = Math.max(0, Math.min(index - before, all.length - limit));
    const stop = Math.min(all.length, start + limit);
    return { messages: store.withMediaSizes(threadId, all.slice(start, stop)).map(pageMessage), hasMore: start > 0 };
  }

  return { messagePage, olderPage, messageWindow };
}
