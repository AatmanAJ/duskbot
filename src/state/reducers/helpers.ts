import type { MausMotion } from "@/lib/mascot";
import { firstUnreadMessageId } from "@/lib/unread-divider";
import type { AppState, Bot, Message, OptionCardData, Task, TaskUpdatePatch } from "../store";
import { hasMessage } from "../store-index";

export function currentTaskBot(bot: Bot, threadId = bot.threadId): Bot {
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  if (!task) return bot;
  return {
    ...bot,
    threadId,
    modelSelection: task.modelSelection ?? bot.modelSelection,
    approvalMode: task.approvalMode ?? (task.autoApprove === undefined ? bot.approvalMode : undefined),
    autoApprove: task.autoApprove ?? bot.autoApprove,
    alwaysAllow: task.alwaysAllow ?? bot.alwaysAllow,
    activity: task.activity ?? bot.activity,
    busy: task.busy ?? (task.activity ? task.activity === "working" || task.activity === "waiting-on-you" : bot.busy),
    unread: task.unread ?? bot.unread,
    pinnedMessageId: task.pinnedMessageId,
    turnStartedAt: task.turnStartedAt ?? null,
    waitingForTeammates: task.waitingForTeammates ?? false,
  };
}

export function taskPatchFields(patch: TaskUpdatePatch): Partial<Task> {
  const { acknowledgeLocalAuto: _localAck, updateBotDefault: _modelDefault, nextTurn: _nextTurn, resetApprovalToAsk, projectId, archivedAt, snoozedUntil, surface, pinned, link, ...fields } = patch;
  return { ...fields, ...(resetApprovalToAsk ? { approvalMode: "ask", autoApprove: false, alwaysAllow: [] } : {}),
    ...(projectId === undefined ? {} : { projectId: projectId ?? undefined }),
    ...(archivedAt === undefined ? {} : { archivedAt: archivedAt ?? undefined }),
    ...(snoozedUntil === undefined ? {} : { snoozedUntil: snoozedUntil ?? undefined }),
    ...(surface === undefined ? {} : { surface: surface ?? undefined, surfaceAuto: undefined }),
    ...(pinned === undefined ? {} : { pinned: pinned ? true : undefined }),
    ...(link === undefined ? {} : { link: link ?? undefined }) };
}

export function openedUnreadDivider(state: AppState, threadId: string, unread: boolean, messages: readonly Message[], lastReadMessageId?: string): AppState["unreadDivider"] {
  if (!unread) return state.unreadDivider?.threadId === threadId ? state.unreadDivider : null;
  const messageId = firstUnreadMessageId(messages, lastReadMessageId);
  return messageId ? { threadId, messageId } : null;
}

export function reconcileModelVariantSessions(state: AppState): AppState {
  const sessions = Object.entries(state.modelVariantSessions);
  const kept = sessions.filter(([threadId, session]) => {
    const owner = state.bots.find((bot) => bot.threadId === threadId || bot.tasks?.some((task) => task.threadId === threadId));
    if (!owner) return false;
    const selection = currentTaskBot(owner, threadId).modelSelection;
    return selection.instanceId === session.instanceId && selection.model === session.model;
  });
  return kept.length === sessions.length ? state : { ...state, modelVariantSessions: Object.fromEntries(kept) };
}

export function bumpTranscriptGeneration(state: AppState, threadId: string | undefined | null): AppState {
  if (!threadId) return state;
  return {
    ...state,
    transcriptGeneration: {
      ...state.transcriptGeneration,
      [threadId]: (state.transcriptGeneration[threadId] ?? 0) + 1,
    },
  };
}

/** Every row with the patch's id swapped for it; the same array when the transcript does not hold it. */
export function patchedRows(messages: Message[], patch: Message): Message[] {
  return hasMessage(messages, patch.id) ? messages.map((message) => (message.id === patch.id ? patch : message)) : messages;
}

export function updateBot(state: AppState, botId: string, fn: (b: Bot) => Bot): AppState {
  return { ...state, bots: state.bots.map((b) => (b.id === botId ? fn(b) : b)) };
}

export function withMascotMotion(
  state: AppState,
  botId: string,
  kind: Exclude<MausMotion, "none">,
): AppState {
  return {
    ...state,
    mascotMotion: {
      botId,
      nonce: (state.mascotMotion?.nonce ?? 0) + 1,
      kind,
    },
  };
}

export function withPatchedCard(messages: Message[], messageId: string, patch: Partial<OptionCardData>): Message[] {
  return messages.map((m) => (m.id === messageId && m.card ? { ...m, card: { ...m.card, ...patch } } : m));
}

export function patchCard(state: AppState, botId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return updateBot(state, botId, (b) => ({ ...b, messages: withPatchedCard(b.messages, messageId, patch) }));
}

export function patchGroupCard(state: AppState, groupId: string, messageId: string, patch: Partial<OptionCardData>): AppState {
  return {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId ? { ...g, messages: withPatchedCard(g.messages, messageId, patch) } : g,
    ),
  };
}

export function openOnboardingCard(bot: Bot): Message | undefined {
  return bot.messages.find(
    (message) => message.kind === "options" && message.card && !message.card.requestId && !message.card.dismissed,
  );
}

export function dismissOnboardingCard(state: AppState, botId: string): AppState {
  const bot = state.bots.find((candidate) => candidate.id === botId);
  const quiz = bot ? openOnboardingCard(bot) : undefined;
  return quiz ? patchCard(state, botId, quiz.id, { dismissed: true }) : state;
}
