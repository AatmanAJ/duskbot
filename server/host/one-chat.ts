// Each bot has one chat: work a teammate sends it lands there, never in a thread of its own.
import { activePath, mergeThread } from "../cloud-chat-merge.ts";
import type { Message, Store, TaskRecord } from "../store.ts";

type ChatStore = Pick<Store, "bots" | "taskByThread" | "messagesFor" | "activeLeaf" | "replaceTranscript" | "deleteTask" | "patchMessage" | "patchTask">;

export interface OneChatDeps {
  store: ChatStore;
  /** The bot's main chat among its threads, leaving out `apart`. */
  mainThread(botId: string, apart: ReadonlySet<string>): string | undefined;
  /** A team's Cloud keeps each person's conversation apart from the team's chat, so it keeps the old threads. */
  team: boolean;
  /** Security invariant: work from outside, or a Cloud guest's, may not reach (and so confine) the bot's own chat. */
  confined(fromThreadId: string, toThreadId: string): boolean;
}

export const isWorkThread = (task: Pick<TaskRecord, "openedBy" | "routineRunId">): boolean =>
  task.openedBy?.kind === "work" && !task.openedBy.roomLane && !task.routineRunId;

/** A page of a chat is its last rows in storage order: the visible path keeps its order, other branches fall in by time. */
export function storageOrder(rows: readonly Message[], leaf: string | null): Message[] {
  const path = activePath(rows, leaf), onPath = new Set(path.map((row) => row.id));
  const rest = rows.filter((row) => !onPath.has(row.id)).sort((a, b) => a.at - b.at);
  const out: Message[] = [];
  for (let i = 0, j = 0; i < path.length || j < rest.length;) out.push(j >= rest.length || (i < path.length && path[i]!.at <= rest[j]!.at) ? path[i++]! : rest[j++]!);
  return out;
}

export function createOneChat(deps: OneChatDeps) {
  const { store } = deps;
  const linked = (rows: readonly Message[]): Message[] => rows.map((row, index) => row.parentId === undefined ? { ...row, parentId: rows[index - 1]?.id ?? null } : row);
  const workThreads = (bot: { tasks?: TaskRecord[] }) => new Set((bot.tasks ?? []).filter(isWorkThread).map((task) => task.threadId));

  /** The chat a teammate's direct message goes to, or undefined where it keeps the old routing: `thread` names another
   * thread, or the bot's chat is waiting on the sender's work (`waiting`: the threads up the sender's chain). */
  function home(botId: string, fromThreadId: string, thread: string, waiting: ReadonlySet<string>): TaskRecord | undefined {
    const bot = store.bots.find((one) => one.id === botId);
    if (deps.team || !bot) return undefined;
    const threadId = deps.mainThread(botId, workThreads(bot));
    const task = threadId ? store.taskByThread(botId, threadId) : undefined;
    if (!task || task.archivedAt !== undefined || waiting.has(task.threadId) || deps.confined(fromThreadId, task.threadId)) return undefined;
    return thread === "standing" || thread === "new" || thread === task.threadId ? task : undefined;
  }

  /** Folds every work thread a teammate opened into the bot's main chat, by time, then removes it. A thread still in use,
   * or one that came from outside, stays for a later start. Rows are moved, never dropped. */
  function fold({ inUse, apart }: { inUse(threadId: string): boolean; apart(threadId: string): boolean }): number {
    if (deps.team) return 0;
    let folded = 0;
    for (const bot of [...store.bots]) {
      const work = workThreads(bot);
      if (!work.size) continue;
      const mainId = deps.mainThread(bot.id, work);
      if (!mainId) continue;
      const threads = (bot.tasks ?? []).filter((task) => work.has(task.threadId) && !task.outside && !inUse(task.threadId) && !apart(task.threadId))
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const task of threads) {
        const rows = linked(store.messagesFor(task.threadId));
        if (rows.length) {
          const here = linked(store.messagesFor(mainId));
          const merged = mergeThread({ rows, leaf: store.activeLeaf(task.threadId) }, { rows: here, leaf: store.activeLeaf(mainId) });
          const parents = new Map(merged.relinked.map((link) => [link.id, link.parentId]));
          const all = [...here.map((row) => parents.has(row.id) ? { ...row, parentId: parents.get(row.id)! } : row), ...merged.added];
          store.replaceTranscript(mainId, storageOrder(all, merged.leaf), merged.leaf);
        }
        const opener = task.openedBy;
        if (opener?.threadId) {
          for (const row of store.messagesFor(opener.threadId)) {
            if (row.threadRef?.threadId === task.threadId) store.patchMessage(opener.threadId, row.id, { threadRef: { ...row.threadRef, threadId: mainId } });
          }
        }
        if (task.unread) store.patchTask(bot.id, mainId, { unread: true });
        store.deleteTask(bot.id, task.threadId);
        folded += 1;
      }
    }
    return folded;
  }

  return { home, fold };
}
