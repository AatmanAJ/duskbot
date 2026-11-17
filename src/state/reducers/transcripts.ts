import { firstUnreadMessageId, threadReadCursor } from "@/lib/unread-divider";
import { movesThreadToTop } from "../../../shared/wire";
import { optimisticMessageId } from "../optimistic-send";
import { reconcileSnapshotQueues } from "../queue-receipts";
import { foldSnapshotOntoStreamed } from "../room-frames";
import { visibleMessages } from "../snapshot-navigation";
import type { Action, AppState, Bot, Group, Message } from "../store";
import { hasMessage, messageById, messagePosition, storeIndex } from "../store-index";
import { bumpThreadUpdatedAt, rewindThreadUpdatedAt } from "../thread-stamps";
import { reconcileTranscript } from "../transcript-cache";
import { bumpTranscriptGeneration, openedUnreadDivider, patchedRows, updateBot, withMascotMotion } from "./helpers";

/** A frame for a thread its bot is not showing waits in `backgroundThreadEvents` until that thread is opened. */
function bufferedThreadEvent(state: AppState, action: TranscriptAction): AppState | undefined {
  if (action.type !== "messageAdded" && action.type !== "messagePatched" && action.type !== "threadActive" && action.type !== "optimisticMessageRemoved") return undefined;
  const owner = storeIndex(state).botsByTaskThread.get(action.threadId)?.find((bot) => bot.threadId !== action.threadId || bot.awaitingThreadSnapshot);
  if (!owner) return undefined;
  const frames = [...(state.backgroundThreadEvents[action.threadId] ?? []), action].slice(-256);
  const buffered = { ...state, backgroundThreadEvents: { ...state.backgroundThreadEvents, [action.threadId]: frames } };
  return (action.type === "messageAdded" || action.type === "messagePatched") && movesThreadToTop(action.message)
    ? bumpThreadUpdatedAt(buffered, action.threadId, action.message.at, true, action.message.turnCompletedAt ?? action.message.at)
    : action.type === "messageAdded" ? bumpThreadUpdatedAt(buffered, action.threadId, action.message.at) : buffered;
}

const TRANSCRIPT_ACTIONS = new Set<Action["type"]>([
  "transcriptSnapshot",
  "transcriptsCached",
  "loadOlderMessages",
  "olderMessages",
  "messageAdded",
  "optimisticMessageRemoved",
  "messagePatched",
  "threadActive",
  "switchBranch",
] as const satisfies ReadonlyArray<Action["type"]>);

export type TranscriptAction = Extract<Action, { type: "transcriptSnapshot" | "transcriptsCached" | "loadOlderMessages" | "olderMessages" | "messageAdded" | "optimisticMessageRemoved" | "messagePatched" | "threadActive" | "switchBranch" }>;

export const isTranscriptAction = (action: Action): action is TranscriptAction => TRANSCRIPT_ACTIONS.has(action.type);

export function reduceTranscripts(state: AppState, action: TranscriptAction): AppState {
  const buffered = bufferedThreadEvent(state, action);
  if (buffered) return buffered;
  switch (action.type) {
    case "transcriptSnapshot": {
      if ((state.transcriptGeneration[action.threadId] ?? 0) !== action.generation) return state;
      const held = new Set(action.heldAtStart);
      const replace = <T extends { threadId: string; messages: Message[]; hasMore?: boolean; transcriptLoaded?: boolean; transcriptStale?: boolean }>(owner: T): T => {
        if (owner.threadId !== action.threadId) return owner;
        if (owner.transcriptLoaded === false) return { ...owner, messages: foldSnapshotOntoStreamed(owner.messages, held, action.messages), hasMore: action.hasMore, transcriptLoaded: true, transcriptStale: undefined };
        if (!owner.transcriptStale) return owner;
        return { ...owner, ...reconcileTranscript(owner.messages, held, action.messages, action.hasMore, owner.hasMore), transcriptStale: undefined };
      };
      const loaded = {
        ...state,
        bots: state.bots.map((bot) => {
          const loaded = replace(bot);
          return loaded === bot ? bot : { ...loaded, activeLeafId: bot.activeLeafId === action.leafAtStart ? action.activeLeafId : bot.activeLeafId };
        }),
        groups: state.groups.map(replace),
      };
      const owner = [...loaded.bots, ...loaded.groups].find((candidate) => candidate.threadId === action.threadId);
      if (owner && (state.unreadDivider?.threadId === action.threadId || state.unreadDividerPending === action.threadId)) {
        const cursor = "modelSelection" in owner ? threadReadCursor(owner) : owner.lastReadMessageId;
        const messageId = firstUnreadMessageId(owner.messages, cursor);
        loaded.unreadDivider = messageId ? { threadId: action.threadId, messageId } : null;
        loaded.unreadDividerPending = undefined;
      }
      return owner ? reconcileSnapshotQueues(loaded, [owner]) : loaded;
    }
    case "transcriptsCached": {
      const cached = new Map(action.transcripts.map((entry) => [entry.threadId, entry]));
      const seed = <T extends Bot | Group>(owner: T): T => {
        const entry = owner.transcriptLoaded === false ? cached.get(owner.threadId) : undefined;
        if (!entry?.messages.length) return owner;
        const seeded = { ...owner, messages: entry.messages, hasMore: entry.hasMore, transcriptLoaded: true, transcriptStale: true };
        return "modelSelection" in seeded ? { ...seeded, activeLeafId: entry.activeLeafId } : seeded;
      };
      const bots = state.bots.map(seed), groups = state.groups.map(seed);
      if (bots.every((bot, index) => bot === state.bots[index]) && groups.every((group, index) => group === state.groups[index])) return state;
      const opened = [...bots, ...groups].find((owner) => owner.id === state.selectedId);
      const pendingDivider = opened && state.unreadDividerPending === opened.threadId && opened.transcriptLoaded !== false;
      return {
        ...state, bots, groups,
        ...(pendingDivider ? { unreadDivider: openedUnreadDivider(state, opened.threadId, true, "modelSelection" in opened ? visibleMessages(opened) : opened.messages, "modelSelection" in opened ? threadReadCursor(opened) : opened.lastReadMessageId) } : {}),
      };
    }
    case "loadOlderMessages":
      return state.loadingOlder[action.threadId]
        ? state
        : { ...state, loadingOlder: { ...state.loadingOlder, [action.threadId]: true } };
    case "olderMessages": {
      const { [action.threadId]: _done, ...loadingOlder } = state.loadingOlder;
      if ((state.transcriptGeneration[action.threadId] ?? 0) !== action.generation) {
        return { ...state, loadingOlder };
      }
      const prepend = <T extends { messages: Message[]; threadId: string; hasMore?: boolean }>(owner: T): T => {
        const held = new Set(owner.messages.map((message) => message.id));
        return {
          ...owner,
          // A page that raced an edit can overlap held rows; the held copy is newer.
          messages: [...action.messages.filter((message) => !held.has(message.id)), ...owner.messages],
          hasMore: action.hasMore,
        };
      };
      return {
        ...state,
        loadingOlder,
        bots: state.bots.map((bot) => (bot.threadId === action.threadId ? prepend(bot) : bot)),
        groups: state.groups.map((group) => (group.threadId === action.threadId ? prepend(group) : group)),
      };
    }
    case "messageAdded": {
      const index = storeIndex(state);
      const bot = index.botByOpenThread.get(action.threadId);
      if (!bot) {
        const group = index.groupByThread.get(action.threadId);
        if (!group) return state;
        if (group.threadId === action.threadId && hasMessage(group.messages, action.message.id)) return state;
        const stamped = bumpThreadUpdatedAt(state, action.threadId, action.message.at, movesThreadToTop(action.message), action.message.turnCompletedAt ?? action.message.at);
        if (group.threadId !== action.threadId) return stamped;
        const optimisticIndex = action.message.sendId ? messagePosition(group.messages, optimisticMessageId(action.message.sendId)) : -1;
        return {
          ...stamped,
          groups: stamped.groups.map((g) =>
            g.id === group.id
              ? {
                  ...g,
                  messages: optimisticIndex >= 0
                    ? g.messages.map((message, index) =>
                        index === optimisticIndex ? action.message : message
                      )
                    : [...g.messages, action.message],
                }
              : g,
          ),
        };
      }
      // The POST response and its SSE frame race; moving the leaf back to a repeat can hide a newer reply.
      if (hasMessage(bot.messages, action.message.id)) return state;
      const stamped = bumpThreadUpdatedAt(state, action.threadId, action.message.at, movesThreadToTop(action.message), action.message.turnCompletedAt ?? action.message.at);
      const optimisticId = action.message.sendId
        ? optimisticMessageId(action.message.sendId)
        : null;
      const optimisticIndex = optimisticId ? messagePosition(bot.messages, optimisticId) : -1;
      if (optimisticIndex >= 0) {
        return updateBot(stamped, bot.id, (current) => ({
          ...current,
          messages: current.messages.map((message, index) =>
            index === optimisticIndex ? action.message : message
          ),
          // a leaf moved back to the send's parent (a snapshot older than the send) still follows the send
          activeLeafId: current.activeLeafId === optimisticId || (current.activeLeafId ?? null) === (action.message.parentId ?? null)
            ? action.message.id
            : current.activeLeafId,
        }));
      }
      const next = updateBot(stamped, bot.id, (b) => {
        // A message parented off the leaf is a late chain-insert; the leaf stays put.
        const adoptsLeaf = (action.message.parentId ?? null) === (b.activeLeafId ?? null);
        return { ...b, messages: [...b.messages, action.message], activeLeafId: adoptsLeaf ? action.message.id : b.activeLeafId };
      });
      const motion =
        action.message.role === "user" && action.message.kind === "text" && Boolean(action.message.queueId)
          ? "working"
          : action.message.kind === "options"
          ? "thinking"
          : action.message.kind === "activity"
            ? action.message.tool?.ok === false
              ? "failure"
              : action.message.tool?.ok === true
                ? "success"
                : "working"
            : action.message.role === "bot" && action.message.kind === "text"
              ? "blink"
              : null;
      const animated = motion ? withMascotMotion(next, bot.id, motion) : next;
      return animated;
    }
    case "optimisticMessageRemoved": {
      const id = optimisticMessageId(action.sendId);
      const remove = (messages: Message[], optimistic: Message) => messages
        .filter((message) => message.id !== id)
        .map((message) => message.optimisticThreadOrderAt === optimistic.at
          ? { ...message, optimisticThreadOrderAt: optimistic.optimisticThreadOrderAt }
          : message);
      const bot = storeIndex(state).botByOpenThread.get(action.threadId);
      if (bot) {
        const optimistic = messageById(bot.messages, id);
        if (!optimistic) return state;
        const cleared = updateBot(state, bot.id, (current) => ({
          ...current,
          messages: remove(current.messages, optimistic),
          activeLeafId: current.activeLeafId === id
            ? (action.restoreLeafId !== undefined ? action.restoreLeafId : (optimistic.parentId ?? null))
            : current.activeLeafId,
        }));
        const task = bot.tasks?.find((candidate) => candidate.threadId === action.threadId);
        const kept = cleared.bots.find((candidate) => candidate.id === bot.id)?.messages ?? [];
        return rewindThreadUpdatedAt(cleared, action.threadId, kept, task?.createdAt ?? 0, bot.hasMore ? optimistic.optimisticThreadOrderAt : undefined);
      }
      const group = state.groups.find((candidate) => candidate.threadId === action.threadId);
      const optimistic = group && messageById(group.messages, id);
      if (!group || !optimistic) return state;
      const cleared = {
        ...state,
        groups: state.groups.map((candidate) => candidate.id === group.id
          ? { ...candidate, messages: remove(candidate.messages, optimistic) }
          : candidate),
      };
      const task = group.tasks?.find((candidate) => candidate.threadId === action.threadId);
      const kept = cleared.groups.find((candidate) => candidate.id === group.id)?.messages ?? [];
      return rewindThreadUpdatedAt(cleared, action.threadId, kept, task?.createdAt ?? group.createdAt, group.hasMore ? optimistic.optimisticThreadOrderAt : undefined);
    }
    case "messagePatched": {
      const stamped = movesThreadToTop(action.message) ? bumpThreadUpdatedAt(state, action.threadId, action.message.at, true, action.message.turnCompletedAt ?? action.message.at) : state;
      const bot = storeIndex(stamped).botByOpenThread.get(action.threadId);
      if (!bot) {
        const group = stamped.groups.find((g) => g.threadId === action.threadId);
        if (!group) return stamped;
        return {
          ...stamped,
          groups: stamped.groups.map((g) =>
            g.id === group.id
              ? { ...g, messages: patchedRows(g.messages, action.message), previewMessages: g.previewMessages && patchedRows(g.previewMessages, action.message) }
              : g,
          ),
        };
      }
      const motion =
        action.message.kind === "activity"
          ? action.message.tool?.ok === false
            ? "failure"
            : action.message.tool?.ok === true
              ? "success"
              : "working"
          : null;
      const next = motion ? withMascotMotion(stamped, bot.id, motion) : stamped;
      return updateBot(next, bot.id, (b) => ({
        ...b,
        messages: patchedRows(b.messages, action.message),
        previewMessages: b.previewMessages && patchedRows(b.previewMessages, action.message),
      }));
    }
    case "threadActive": {
      const bot = state.bots.find((b) => b.threadId === action.threadId);
      if (!bot) return state;
      return updateBot(bumpTranscriptGeneration(state, action.threadId), bot.id, (b) => ({
        ...b,
        activeLeafId: action.activeLeafId,
      }));
    }
    case "switchBranch": {
      const bot = state.bots.find((b) => b.id === action.botId);
      if (!bot) return state;
      let cur = action.messageId;
      for (;;) {
        const children = bot.messages.filter((m) => m.parentId === cur);
        if (!children.length) break;
        cur = children.reduce((a, b) => (b.at >= a.at ? b : a)).id;
      }
      return updateBot(bumpTranscriptGeneration(state, bot.threadId), action.botId, (b) => ({ ...b, activeLeafId: cur }));
    }
  }
}
