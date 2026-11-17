import { useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { useCopyFeedback } from "@/lib/copy-text";
import { botUnreadThreadIds, markBotRead } from "@/lib/folder-read";
import { api, useStoreSelector, type Bot } from "@/state/store";
import { useStoreRef } from "@/state/store-ref";
import { announceArchiveNotice, archiveBotWithNotice } from "../bot-archive";
import { moveBotsToSection } from "../bot-sections";
import { currentArchivableBot, type BotConfirmKind } from "../Sidebar";
import { friendlyError } from "@/lib/plain-error";

export function useBotActions(bot: Bot) {
  const store = useStoreRef();
  const { dispatch } = store;
  const visibleBotCount = useStoreSelector((s) => s.bots.filter((candidate) => !candidate.hidden).length);
  const deleting = useStoreSelector((s) => s.deletingBots[bot.id] === true);
  const [confirm, setConfirm] = useState<BotConfirmKind | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const readInFlight = useRef(false);
  const copy = useCopyFeedback(bot.threadId);

  const archiveHint = bot.chiefOfStaff
    ? t("botPanel.ui.sidebarBotArchiveBlockedChief")
    : visibleBotCount <= 1
      ? t("botPanel.ui.sidebarBotArchiveBlockedLast")
      : undefined;

  const togglePin = () => dispatch({ type: "updateBot", botId: bot.id, patch: { pinned: !bot.pinned } });
  const duplicate = () => dispatch({ type: "duplicateBot", botId: bot.id });

  const markAllRead = async () => {
    if (readInFlight.current) return;
    readInFlight.current = true;
    setReading(true);
    setReadError(null);
    try {
      await markBotRead(bot, api, (updated) => dispatch({ type: "botPatched", bot: updated }));
    } catch (error) {
      const guidance = t("sidebar.bot.markAllReadFailed");
      const why = error instanceof Error ? friendlyError(error, "") : "";
      setReadError(why ? `${guidance} ${why}` : guidance);
    } finally {
      readInFlight.current = false;
      setReading(false);
    }
  };

  // The sidebar's own archive path: its corner notice says "Archived" with Undo, or why it failed.
  const archive = async () => {
    const state = store.state();
    const current = currentArchivableBot(state.bots, bot.id);
    if (!current) return;
    await archiveBotWithNotice(current, {
      bots: state.bots,
      selectedId: state.selectedId,
      dispatch,
      notify: (notice) => {
        // With no sidebar on screen (the calendar), a failure still has to be said somewhere.
        if (!announceArchiveNotice(notice) && notice?.error) dispatch({ type: "error", message: notice.text });
      },
    });
  };

  const requestArchive = () => {
    if (currentArchivableBot(store.state().bots, bot.id)) setConfirm("archive");
  };

  const confirmed = () => {
    const kind = confirm;
    setConfirm(null);
    if (!kind) return;
    dispatch({ type: "toggleSettings", open: false });
    if (kind === "archive") void archive();
    else dispatch({ type: "deleteBot", botId: bot.id });
  };

  const moveToTeam = (section: string) => {
    if ((bot.section?.trim() ?? "") !== section) moveBotsToSection(dispatch, [bot.id], section);
  };

  return {
    togglePin,
    duplicate,
    copyId: copy.copy,
    copyState: copy.state,
    markAllRead: () => void markAllRead(),
    reading,
    readError,
    hasUnread: botUnreadThreadIds(bot).length > 0,
    archiveBlocked: archiveHint !== undefined,
    archiveHint,
    requestArchive,
    requestDelete: () => setConfirm("delete"),
    confirm,
    cancelConfirm: () => setConfirm(null),
    confirmed,
    deleting,
    moveToTeam,
  };
}
