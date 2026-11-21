import type { Bot, Message } from "@/state/store";
import { useTurnLive, type LiveStatus, type TurnLive } from "@/state/turn-status";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { turnNowPhrases } from "@/lib/live-activity";
import { friendlyNowPhrases, plainWord, startsAnywhere } from "@/lib/friendly-activity";
import { WorkingMascot } from "./WorkingMascot";

/** The conversation a working bot's row speaks for: the open one when it is working, else the first one that is. */
export function workingThreadId(bot: Pick<Bot, "threadId" | "tasks">): string {
  const tasks = bot.tasks ?? [];
  if (tasks.some((task) => task.threadId === bot.threadId && task.busy)) return bot.threadId;
  return tasks.find((task) => task.busy)?.threadId ?? bot.threadId;
}

const statusLabel = (live: TurnLive): string | undefined => live.label?.trim() || undefined;

/** The status the bot set for its running turn, when it set one: grok's row says it while the bot works. */
export function useWorkingLabel(bot: Pick<Bot, "threadId" | "tasks">, working: boolean): string | undefined {
  const live = useTurnLive(working ? workingThreadId(bot) : null);
  return working ? statusLabel(live) : undefined;
}

export function SidebarWorkingStep({ bot, last }: { bot: Pick<Bot, "threadId" | "tasks">; last?: Message }) {
  const threadId = workingThreadId(bot);
  const live = useTurnLive(threadId);
  const phrase = statusLabel(live) ?? turnNowPhrases(live.status, threadId === bot.threadId ? last : undefined)?.phrases[0];
  return <span dir="auto" data-sidebar-working-phrase="" className="truncate">{phrase ?? t("chat.activity.thinking")}</span>;
}

/** The longest word a row's working line says: it fits the narrowest sidebar (and the phone list beside its mascot) without being cut. */
export const SIDEBAR_WORD_MAX = 21;

/** One short word for what a working bot does now: its own label when that is short, else the step's plain word, else
 * "Thinking" or "Working". Never a playful word. */
export function sidebarWorkingWord(status: LiveStatus | null, label: string | undefined, message?: Message): string {
  const own = label?.trim();
  if (own && own.length <= SIDEBAR_WORD_MAX) return own;
  const shown = friendlyNowPhrases(status, message);
  const stepRunning = Boolean(status && status.activity !== "thinking") || (message?.kind === "activity" && message.tool?.ok === undefined);
  const word = startsAnywhere(shown.phase) ? plainWord(stepRunning ? "working" : "thinking") : shown.phrases[0];
  return word && word.length <= SIDEBAR_WORD_MAX ? word : plainWord("working");
}

type WorkingRowBot = Pick<Bot, "id" | "threadId" | "tasks" | "color" | "mascotBody" | "mascotFaceColor">;

/** A working row's preview: one short word, after the bot's tiny mascot at work when `mascot` gives its size. */
export function SidebarWorkingWord({ bot, last, mascot, className }: { bot: WorkingRowBot; last?: Message; mascot?: number; className?: string }) {
  const threadId = workingThreadId(bot);
  const live = useTurnLive(threadId);
  const word = sidebarWorkingWord(live.status, live.label, threadId === bot.threadId ? last : undefined);
  return (
    <span data-sidebar-working-word="" className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {mascot !== undefined && <WorkingMascot bot={bot} size={mascot} seed={threadId} />}
      <span dir="auto" className="truncate">{word}</span>
    </span>
  );
}
