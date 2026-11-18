import type { WireMessage } from "../shared/wire.ts";

/** Text messages in the chat, the person's and the bots', before the reminder starts riding each turn. */
export const HABIT_REMINDER_AFTER = 20;

export const HABIT_REMINDER = "Reminder: finish the whole ask this turn without asking leave for safe steps, lead with the result, not a caveat, no narration between tool calls, plain words with no tool or file names, and no time-of-day greeting in an ongoing chat.";

export function chatMessageCount(messages: ReadonlyArray<Pick<WireMessage, "kind">>): number {
  let count = 0;
  for (const message of messages) if (message.kind === "text") count += 1;
  return count;
}

export function habitReminder(chatMessages: number): string {
  return chatMessages >= HABIT_REMINDER_AFTER ? ` ${HABIT_REMINDER}` : "";
}
