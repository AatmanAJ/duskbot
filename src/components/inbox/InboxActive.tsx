// Under the inbox's lines: what else is going on, each opening where it is. What a team's person has to fix, and the
// conversations at work.
import type { InboxView } from "../../../shared/inbox";
import { t } from "@/lib/i18n";
import { useDispatch, useStoreSelector } from "@/state/store";
import { useTeamPeople } from "@/state/team-people";
import { AttentionThreadRows, attentionJumpAction, crossBotAttentionThreads } from "../SidebarBotActivity";
import { NeedsYouLine } from "../TeamOwner";
import { closeInbox } from "@/state/inbox";
import { inboxFixes } from "./inbox-view";

export function InboxActive({ view }: { view: InboxView | null }) {
  const dispatch = useDispatch();
  const bots = useStoreSelector((s) => s.bots);
  const pendingQueued = useStoreSelector((s) => s.pendingQueued);
  const groups = useStoreSelector((s) => s.groups);
  const team = useTeamPeople();
  const rows = view?.rows ?? [];
  const asked = new Set(rows.filter((row) => row.tab === "needs-you").map((row) => row.origin?.threadId));
  const news = new Set(rows.filter((row) => row.tab === "info").map((row) => row.origin?.threadId));
  const atWork = (task: { busy?: boolean; activity?: string; queued?: boolean }) => task.busy === true || task.activity === "working" || task.queued === true;
  const entries = crossBotAttentionThreads(bots, pendingQueued, undefined, groups)
    .filter((entry) => !asked.has(entry.task.threadId) && (atWork(entry.task) || !news.has(entry.task.threadId)));
  const fixes = inboxFixes(team?.needsYou, view);
  return (
    <>
      {fixes.length > 0 && (
        <section data-inbox-fixes className="border-t border-transparent px-1.5 py-1.5">
          {fixes.map((item) => <NeedsYouLine key={`${item.kind}:${item.id}`} item={item} onOpened={closeInbox} />)}
        </section>
      )}
      {entries.length > 0 && (
        <section data-inbox-active aria-label={t("attention.active")} className="border-t border-transparent px-1.5 py-1.5">
          <div className="px-2 py-0.5 text-[12px] font-medium text-ink-secondary">{t("attention.active")}</div>
          <AttentionThreadRows inset entries={entries} onJump={(entry) => dispatch(attentionJumpAction(entry))} />
        </section>
      )}
    </>
  );
}
