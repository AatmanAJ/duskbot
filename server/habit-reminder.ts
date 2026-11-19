import type { WireMessage } from "../shared/wire.ts";

/** Text messages in the chat, the person's and the bots', before the reminder starts riding each turn. */
export const HABIT_REMINDER_AFTER = 20;

export const HABIT_REMINDER = "Reminder: do the whole ask now, not a plan; say done only for what a tool did this turn; stop at once when told; result first; no narration between tool calls; no tool or file names; no time-of-day greeting in an ongoing chat.";

export function chatMessageCount(messages: ReadonlyArray<Pick<WireMessage, "kind">>): number {
  let count = 0;
  for (const message of messages) if (message.kind === "text") count += 1;
  return count;
}

export function habitReminder(chatMessages: number): string {
  return chatMessages >= HABIT_REMINDER_AFTER ? ` ${HABIT_REMINDER}` : "";
}
