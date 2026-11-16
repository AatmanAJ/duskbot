import {
  CheckCircle2,
  CircleAlert,
  Hand,
  Loader2,
  Square,
  XCircle,
} from "../icons";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useDispatch, type Message } from "@/state/store";
import type { GroupGoalRunCardData } from "../../shared/group-goal-run";

const DETAIL_LIMIT = 280;

// a status word in its semantic colour beside its icon; working and stopped stay neutral
const COPY = {
  working: { label: "chat.activity.working", tone: "text-ink-secondary" },
  completed: { label: "routines.goal.completed", tone: "text-success" },
  "needs-input": { label: "routines.goal.needs-input", tone: "text-warning" },
  blocked: { label: "routines.goal.blocked", tone: "text-warning" },
  "limit-reached": { label: "routines.goal.limit-reached", tone: "text-warning" },
  paused: { label: "routines.goal.paused", tone: "text-warning" },
  stopped: { label: "routines.goal.stopped", tone: "text-ink-secondary" },
  failed: { label: "routines.goal.failed", tone: "text-danger" },
} satisfies Record<
  GroupGoalRunCardData["status"],
  { label: LocaleKey; tone: string }
>;

function compact(value: string | undefined, limit: number): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

function StatusIcon({ status }: { status: GroupGoalRunCardData["status"] }) {
  const className = "size-4 shrink-0";
  switch (status) {
    case "working":
      return <Loader2 aria-hidden="true" className={cn(className, "animate-spin text-ink-tertiary motion-reduce:animate-none")} />;
    case "completed":
      return <CheckCircle2 aria-hidden="true" className={cn(className, "text-success")} />;
    case "needs-input":
      return <Hand aria-hidden="true" className={cn(className, "text-warning")} />;
    case "blocked":
    case "limit-reached":
    case "paused":
      return <CircleAlert aria-hidden="true" className={cn(className, "text-warning")} />;
    case "stopped":
      return <Square aria-hidden="true" className={cn(className, "text-ink-secondary")} />;
    case "failed":
      return <XCircle aria-hidden="true" className={cn(className, "text-danger")} />;
  }
}

/** `solo` is a one-on-one chat's run, where the bot works alone; `onStop` ends a working run from the card. */
export function GoalRunCard({ message, solo = false, onStop }: { message: Message; solo?: boolean; onStop?: () => void }) {
  const run = message.goalRun;
  if (!run) {
    const fallback = compact(message.text, DETAIL_LIMIT);
    return fallback ? (
      <div className="w-fit max-w-[min(var(--chat-bubble-max),var(--chat-card-pct))] rounded-2xl bg-card px-4 py-2.5 text-[14px] leading-relaxed text-ink">
        {fallback}
      </div>
    ) : null;
  }

  const copy = COPY[run.status];
  const label = t(copy.label);
  const goal = compact(run.goal, 180);
  const detail = compact(run.detail, DETAIL_LIMIT);
  const turns = run.status === "working"
    ? t("goalRun.turnOf", { turn: Math.min(run.turnCount + 1, run.maxTurns), max: run.maxTurns })
    : run.turnCount === 1 ? t("chat.usage.turnsOne") : t("chat.usage.turnsMany", { count: run.turnCount });

  return (
    <section
      aria-label={t("goalRun.aria", { status: label })}
      className="w-full max-w-[680px] rounded-2xl bg-card px-3.5 py-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex shrink-0">
          <StatusIcon status={run.status} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="truncate text-[14px] font-medium text-ink">{goal || t("composer.goal.chip")}</h3>
            <span aria-live="polite" className={cn("text-[13px]", copy.tone)}>
              {label}
            </span>
          </div>
          {detail && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-secondary">{detail}</p>}
          <p className="mt-1 text-[12px] text-ink-tertiary">
            {solo ? run.coordinatorName : t("goalRun.coordinating", { name: run.coordinatorName })} · {turns}
          </p>
        </div>
        {onStop && run.status === "working" && (
          <button
            type="button"
            onClick={onStop}
            className="flex h-7 shrink-0 items-center rounded-full bg-ink/[0.06] px-2.5 text-[13px] text-ink-secondary transition-colors hover:bg-ink/[0.11] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("chat.stop")}
          </button>
        )}
      </div>
    </section>
  );
}

export function GoalRunRow({ botId, threadId, message }: { botId: string; threadId?: string; message: Message }) {
  const dispatch = useDispatch();
  return (
    <div className="flex justify-start">
      <GoalRunCard message={message} solo onStop={() => dispatch({ type: "interrupt", botId, threadId })} />
    </div>
  );
}
