import { useState, type ReactNode } from "react";
import { Loader2, Trash2 } from "../icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isTickable, summarizeDelete } from "@/lib/bulk-select";
import { currentTaskBot, useDispatch, useStoreSelector, type Action, type Bot } from "@/state/store";
import { botById } from "@/state/store-index";
import { bulkDeleteBody, bulkDeleteOutcome, deleteThreadsInBulk } from "./BulkSelectBar";
import { ConfirmDialog } from "./ConfirmDialog";

export function BotDeleteMenuItem({ deleting, onClick, className = "flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px]", icon, label, labelClassName }: { deleting: boolean; onClick: () => void; className?: string; icon?: ReactNode; label?: string; labelClassName?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={deleting}
      aria-busy={deleting || undefined}
      onClick={onClick}
      title={deleting ? t("sidebar.bot.deleteCheckingTitle") : undefined}
      className={cn(
        "text-danger",
        deleting ? "cursor-default opacity-40" : "hover:bg-menu-hover",
        className,
      )}
    >
      {deleting ? <Loader2 size={16} className="animate-spin" /> : icon ?? <Trash2 size={16} />}
      <span className={labelClassName}>{deleting ? t("sidebar.bot.deleteChecking") : label ?? t("common.delete")}</span>
    </button>
  );
}

export function allThreadRows(bot: Bot) {
  return (bot.tasks ?? []).filter((task) => !task.routineRunId).map((task) => {
    const thread = currentTaskBot(bot, task.threadId);
    return { ...task, busy: thread.busy, activity: thread.activity };
  });
}

type Dispatch = (action: Action) => void;

export async function deleteAllThreads(bot: Bot, dispatch: Dispatch): Promise<void> {
  const outcome = await deleteThreadsInBulk({ botId: bot.id }, allThreadRows(bot).map((row) => row.threadId), dispatch);
  // the rows vanishing says it all, as in grok; a note only when something was kept or failed
  const done = summarizeDelete(outcome.responses);
  if (done.busy || done.missing || outcome.error) dispatch({ type: "notice", notice: { kind: "note", botName: null, text: bulkDeleteOutcome(outcome) } });
}

export function deleteAllThreadsCopy(rows: ReturnType<typeof allThreadRows>, simple = false) {
  const ids = new Set(rows.map((row) => row.threadId));
  const startsFresh = rows.every(isTickable);
  return {
    title: t(simple ? "task.deleteAllConversationsConfirm" : "task.deleteAllConfirm", { count: rows.length }),
    body: bulkDeleteBody(rows, ids, startsFresh),
    confirmLabel: t("task.bulk.delete", { count: rows.length }),
  };
}

export function useDeleteAllThreads(simple = false) {
  const dispatch = useDispatch();
  const [botId, setBotId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const bot = useStoreSelector((state) => botId === null ? undefined : botById(state, botId));
  const run = () => {
    if (!bot || pending) return;
    setPending(true);
    void deleteAllThreads(bot, dispatch).finally(() => { setPending(false); setBotId(null); });
  };
  const dialog = <ConfirmDialog open={bot !== undefined} {...deleteAllThreadsCopy(bot ? allThreadRows(bot) : [], simple)}
    pending={pending} onCancel={() => { if (!pending) setBotId(null); }} onConfirm={run} />;
  return { ask: setBotId, dialog };
}
