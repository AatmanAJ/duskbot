import { describe, expect, it } from "vitest";
import { chatMessageCount, HABIT_REMINDER, HABIT_REMINDER_AFTER, habitReminder } from "./habit-reminder.ts";
import { turnClockLine, withTurnClock } from "./turn-clock.ts";
import { withoutTurnClock } from "./testing/turn-clock-text.ts";

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ role: index % 2 ? "bot" as const : "user" as const, kind: "text" as const }));

describe("habit reminder", () => {
  it("counts only text messages, not activity or digest rows", () => {
    expect(chatMessageCount([...rows(3), { kind: "activity" as const }, { kind: "digest" as const }])).toBe(3);
  });

  it("rides only once the chat reaches 20 messages", () => {
    expect(HABIT_REMINDER_AFTER).toBe(20);
    expect(habitReminder(chatMessageCount(rows(19)))).toBe("");
    expect(habitReminder(chatMessageCount(rows(20)))).toBe(` ${HABIT_REMINDER}`);
    expect(habitReminder(400)).toBe(` ${HABIT_REMINDER}`);
  });

  it("never asks for a time-of-day greeting: it rides only long chats, where one is out of place", () => {
    expect(HABIT_REMINDER).not.toMatch(/\bgreet for\b/);
    expect(HABIT_REMINDER).toContain("no time-of-day greeting in an ongoing chat");
  });

  it("is one fixed short line on the clock line, which the clock-stripping helper still removes whole", () => {
    expect(HABIT_REMINDER).not.toMatch(/\n|\u2014/);
    expect(Math.ceil(Buffer.byteLength(HABIT_REMINDER) / 4)).toBeLessThanOrEqual(60);
    const clock = turnClockLine(Date.UTC(2026, 10, 11, 16, 0), "Asia/Kolkata") + habitReminder(25);
    expect(withoutTurnClock(withTurnClock(clock, "hi guys"))).toBe("hi guys");
  });
});
