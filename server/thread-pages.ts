import * as mdb from "./message-db.ts";
import type { ThreadCache, ThreadState } from "./thread-cache.ts";
import type { Message } from "./store.ts";

export interface ThreadPage {
  messages: Message[];
  hasMore: boolean;
  activeLeafId: string | null;
}

/** Legacy rows without a parentId chain only on a full load, so a bounded page missing that context falls back to one. */
export function tailPage(threads: ThreadCache, threadId: string, legacyFile: string, limit: number): ThreadPage {
  let state = threads.get(threadId);
  if (!state) {
    const tail = mdb.readThreadTail(threadId, legacyFile, limit);
    const legacyRows = tail.hasMore !== undefined && tail.messages.some((m) => m.parentId === undefined);
    if (tail.hasMore !== true || legacyRows) {
      state = threads.load(threadId, legacyRows ? mdb.readThread(threadId, legacyFile) : tail);
    } else {
      return {
        messages: tail.messages,
        hasMore: tail.hasMore,
        activeLeafId: tail.activeLeafId || (tail.messages.at(-1)?.id ?? null),
      };
    }
  }
  const { messages, activeLeafId } = state;
  const start = Math.max(0, messages.length - limit);
  return { messages: messages.slice(start), hasMore: start > 0, activeLeafId };
}

/** The page before `beforeId`, or null when the conversation holds no such message. A thread not loaded yet is read a
 * page from the database; rows stored without a parentId chain only on a full load, so those load it. */
export function pageBefore(threads: ThreadCache, threadId: string, full: () => ThreadState, beforeId: string, limit: number): ThreadPage | null {
  if (!threads.get(threadId)) {
    const page = mdb.readThreadBefore(threadId, beforeId, limit);
    if (page && page.messages.every((m) => m.parentId !== undefined)) return page;
  }
  const { messages, activeLeafId } = full();
  const end = messages.findIndex((m) => m.id === beforeId);
  if (end === -1) return null;
  const start = Math.max(0, end - limit);
  return { messages: messages.slice(start, end), hasMore: start > 0, activeLeafId };
}
