import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DIGEST_CHATS, DIGEST_LINES, NOTE_LINES_BAD, NOTE_LINES_BIG, USAGE_DIGEST_KEYS, USAGE_FRUSTRATION_KEYS, USAGE_RETENTION_DAYS, USAGE_SESSION_KEYS } from "../../shared/usage-signals.ts";
import { BIG_PER_DAY, BIG_PER_WEEK, DIGEST_EVERY_MS, MAX_PER_DAY, TURNS_PER_REPORT, weeklyAllowance } from "../../server/usage-signals.ts";
import { REAL_USE_DAYS, REAL_USE_TURNS } from "../../server/usage-signals-switch.ts";
import { USAGE_RETENTION_DAYS as STORED_DAYS } from "../../apps/dashboard/server/analytics/usage.ts";

const policy = readFileSync(new URL("../../docs/legal/privacy.md", import.meta.url), "utf8").replace(/\s+/g, " ");
const section = (start: string) => { const from = policy.indexOf(start); expect(from).toBeGreaterThan(-1); return policy.slice(from, policy.indexOf("- **", from + 5)); };
const says = (text: string, phrase: string) => expect(text, `the legal page should say "${phrase}"`).toContain(phrase);

/** each field a note record carries, and the words the policy uses for it */
const NOTE_FIELDS: Record<string, string> = {
  id: "a random id that only your computer knows", at: "", summary: "writes a few anonymous sentences", engine: "engine family", category: "task category", tools: "tool kinds",
  apps: "app catalog names", reason: "the failure reason code", signals: "which signals were noticed", retries: "how many times you asked again",
  turns: "its number of turns", minutes: "its length in minutes", failed: "how many turns failed", days: "the week's turns and active days",
};

describe("the legal page says what the code does", () => {
  const notes = section("- **How sessions went**");

  it("names the messages each note's writer reads", () => {
    says(notes, `at most the last ${NOTE_LINES_BAD} messages of that chat`);
    says(notes, `at most the last ${NOTE_LINES_BIG} messages of that chat`);
    says(notes, `at most the last ${DIGEST_LINES} messages of each of your ${DIGEST_CHATS} most recently active chats`);
    says(policy, `at most the last ${NOTE_LINES_BAD} or ${NOTE_LINES_BIG} messages of that chat, or for the weekly note the last ${DIGEST_LINES} of each of your ${DIGEST_CHATS} most recently active chats`);
  });

  it("names the caps", () => {
    expect(DIGEST_EVERY_MS).toBe(7 * 86_400_000);
    says(notes, `at most ${MAX_PER_DAY} notes about a chat that went badly a day (and at most one for every ${TURNS_PER_REPORT} turns of the past week, with at least ${weeklyAllowance(0)} a week), ${BIG_PER_DAY} about a big session a day and ${BIG_PER_WEEK} a week, and 1 weekly note`);
  });

  it("names how long notes and raw records are kept, the same here, on the workspace and in the store", () => {
    expect(STORED_DAYS).toBe(USAGE_RETENTION_DAYS);
    says(section("- **Retention**"), `raw records of your bots' work and the descriptions of how sessions went after ${USAGE_RETENTION_DAYS} days`);
    says(policy, `Notes are not linked to your account and are kept ${USAGE_RETENTION_DAYS} days`);
    says(policy, `lists what your computer sent in the last ${USAGE_RETENTION_DAYS} days`);
  });

  it("calls the switch by the name the app shows", () => {
    const strings = JSON.parse(readFileSync(new URL("../../src/locales/en.json", import.meta.url), "utf8")) as Record<string, string>;
    const name = strings["settings.dataSharing.notes"]!.toLowerCase();
    says(policy.toLowerCase(), name);
    expect(policy.toLowerCase(), "the legal page names a switch the app does not show").not.toContain("session notes");
  });

  it("names when the app asks", () => {
    says(notes, `${REAL_USE_TURNS} finished replies over at least ${REAL_USE_DAYS} different days`);
  });

  it("names every field a note sends", () => {
    const fields = new Set<string>([...USAGE_FRUSTRATION_KEYS, ...USAGE_SESSION_KEYS, ...USAGE_DIGEST_KEYS]);
    expect([...fields].sort(), "a note field was added or removed: say it on the legal page and in NOTE_FIELDS").toEqual(Object.keys(NOTE_FIELDS).sort());
    for (const phrase of Object.values(NOTE_FIELDS)) if (phrase) says(notes, phrase);
  });
});
