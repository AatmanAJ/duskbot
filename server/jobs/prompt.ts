import { eventBlock, eventPrompt } from "../app-events.ts";
import type { JobRecord } from "./supervisor.ts";

/** The line every bot's prompt carries about background jobs. */
export function backgroundJobsPrompt(): string {
  return " You have your own computer that keeps working after this turn: to watch or monitor something and tell the person when it happens (\"watch my Telegram group\", \"let me know when…\") and a plain wait_until or app event can't see it, start a background job (background_job; for Telegram the ready template telegram_watch) instead of a routine that checks every few minutes, and never say you can't run a workflow.";
}

export const DEFAULT_ON_NOTIFY = "Tell the person what happened in one or two lines if it matters to them; otherwise reply NOTHING NEW.";

/** The run a job's notify starts: the bot's own instructions, and what the job sent as untrusted data. */
export function jobRunPrompt(job: Pick<JobRecord, "label" | "onNotify">, note: { id: string; at: number; text: string }): string {
  return eventPrompt(job.onNotify || DEFAULT_ON_NOTIFY, jobBlock(job, note));
}

export function jobBlock(job: Pick<JobRecord, "label">, note: { id: string; at: number; text: string }): string {
  return eventBlock({ appName: `Background job "${job.label}"`, eventName: "notify" }, { id: note.id, receivedAt: note.at, test: false, data: { text: note.text } });
}

/** What a start answers when the job looks like a Telegram watcher: the two things that silently stop one. */
export const TELEGRAM_NOTE =
  "Telegram: in a group a bot only sees /commands and @mentions until privacy mode is off (BotFather → /setprivacy → Disable, then remove and re-add the bot) or it is a group admin; getMe's can_read_all_group_messages false means it is on, so tell the person that one-line fix (telegram_watch does this itself). Only one program may read a bot's updates: getUpdates answers 409 while a webhook or another poller has them.";
