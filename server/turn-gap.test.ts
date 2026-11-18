import { describe, expect, it } from "vitest";
import { MID_CHAT_NOTE } from "./turn-clock.ts";
import { gapWords, GREETING_GAP_MS, greetingFits, personClock, previousPersonMessageAt, QUIET_GAP_MS, quietGapNote } from "./turn-gap.ts";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

describe("previousPersonMessageAt", () => {
  it("finds the person's last text before the current message, ignoring the bot, activity rows and the current one", () => {
    const messages = [
      { id: "a", role: "user" as const, kind: "text" as const, at: 1_000 },
      { id: "b", role: "bot" as const, kind: "text" as const, at: 5_000 },
      { id: "c", role: "user" as const, kind: "activity" as const, at: 6_000 },
      { id: "d", role: "user" as const, kind: "text" as const, at: 3_000 },
      { id: "now", role: "user" as const, kind: "text" as const, at: 9_000 },
    ];
    expect(previousPersonMessageAt(messages, "now")).toBe(3_000);
  });

  it("is null on the person's first message", () => {
    expect(previousPersonMessageAt([{ id: "now", role: "user", kind: "text", at: 1 }], "now")).toBeNull();
  });
});

describe("gapWords", () => {
  it("rounds down the way a person says it", () => {
    expect(gapWords(6 * HOUR + 59 * 60_000)).toBe("6 hours");
    expect(gapWords(DAY)).toBe("1 day");
    expect(gapWords(3 * DAY + 20 * HOUR)).toBe("3 days");
    expect(gapWords(16 * DAY)).toBe("2 weeks");
    expect(gapWords(95 * DAY)).toBe("3 months");
  });
});

describe("quietGapNote", () => {
  const now = Date.parse("2026-11-13T10:00:00Z");
  it("says nothing inside one sitting or on a first message", () => {
    expect(quietGapNote(now - QUIET_GAP_MS + 1, now)).toBe("");
    expect(quietGapNote(null, now)).toBe("");
  });

  it("names the gap and that older plans may be stale once the chat sat quiet", () => {
    const note = quietGapNote(now - 3 * DAY, now);
    expect(note).toContain("previous message in this chat was 3 days ago");
    expect(note).toContain("may be out of date");
    expect(note.startsWith(" ")).toBe(true);
  });
});

describe("personClock", () => {
  const now = Date.parse("2026-11-18T09:30:00Z");
  const HOUR = 60 * 60_000;
  const greets = (clock: string) => clock.includes("Wednesday afternoon, 2026-11-18 15:00") && !clock.includes(MID_CHAT_NOTE);
  const quiet = (clock: string) => !/morning|afternoon|evening|night/.test(clock) && clock.includes(MID_CHAT_NOTE);

  it("names the part of the day on a chat's first message and after a long quiet", () => {
    expect(greets(personClock(now, "Asia/Kolkata", null))).toBe(true);
    expect(greets(personClock(now, "Asia/Kolkata", now - GREETING_GAP_MS))).toBe(true);
    expect(greets(personClock(now, "Asia/Kolkata", now - 3 * 24 * HOUR))).toBe(true);
  });

  it("keeps the time but drops the greeting hint mid-conversation", () => {
    for (const clock of [personClock(now, "Asia/Kolkata", now - 2 * 60_000), personClock(now, "Asia/Kolkata", now - GREETING_GAP_MS + 1), personClock(now, "Asia/Kolkata", undefined)]) {
      expect(quiet(clock)).toBe(true);
      expect(clock).toContain("Wednesday, 2026-11-18 15:00 Asia/Kolkata");
    }
  });

  it("allows a greeting from four hours of quiet on", () => {
    expect(greetingFits(null, now)).toBe(true);
    expect(greetingFits(now - GREETING_GAP_MS + 1, now)).toBe(false);
    expect(greetingFits(now - GREETING_GAP_MS, now)).toBe(true);
  });
});
