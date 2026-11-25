import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createAboutMe } from "./about-me.ts";
import { DATA_DIR } from "./config.ts";
import { FORGET_ASK } from "./forget-traces.ts";
import { aboutOwner } from "./memory-facts.ts";
import { botMemoryUpdate } from "./memory-forget.ts";
import { closeMessageDb } from "./message-db.ts";
import { correctedChatTitles } from "./recent-work.ts";
import { appendMemoryLog, listMemoryTopics, memoryLogPath, readMemoryLog, workspaceDir, writeMemoryFile, writeMemoryLog, writeMemoryTopic, WORKSPACES_DIR } from "./workspace.ts";

const BOT = "forget-traces";
const SOURCE = 'chat "fun fact i used to work at greggs on briggate t…"';

beforeEach(() => {
  closeMessageDb();
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
});

const everything = () => [
  readFileSync(join(workspaceDir(BOT), "MEMORY.md"), "utf8"),
  ...listMemoryTopics(BOT).map((topic) => readFileSync(join(workspaceDir(BOT), "memory", topic.name), "utf8")),
  readMemoryLog(BOT, "2026-11-30.md") ?? "",
].join("\n");

describe("forget leaves no trace", () => {
  it("scrubs the fact's words from other facts' source quotes, an emptied topic, struck lines and daily logs, and keeps the rest", () => {
    writeMemoryFile(BOT, [
      `- 2026-11-30 · from ${SOURCE} · Aisha worked at Greggs on Briggate until September.`,
      `- 2026-11-30 · from ${SOURCE} · ~~Aisha is from Leeds.~~ · superseded 2026-11-30`,
      `- 2026-11-30 · from ${SOURCE} · Aisha is originally from Manchester.`,
    ].join("\n") + "\n");
    writeMemoryTopic(BOT, "climbing.md", `---\ntitle: climbing\n---\n- 2026-11-30 · from ${SOURCE} · Aisha climbs about three times a week.\n`);
    writeMemoryTopic(BOT, "greggs.md", "---\ntitle: greggs\naliases: [Briggate, former job]\n---\n");
    writeMemoryLog(BOT, "2026-11-30.md", `- 08:40 · from ${SOURCE} · Got it: Manchester, Greggs on Briggate until September, climbing 3x a week.\n- 09:10 · from chat "lunch" · Booked lunch at noon.\n`);
    const about = { owner: aboutOwner(), text: "" };
    const aboutMe = createAboutMe({ read: () => "", write: () => {}, changed: () => {}, today: () => "2026-12-01" });
    const result = botMemoryUpdate(BOT, { action: "forget", oldText: "Greggs" }, { source: 'chat "what do you remember"', aboutMe, about });
    expect(result).toMatchObject({ ok: true, forgotten: ["Aisha worked at Greggs on Briggate until September."] });
    const all = everything();
    expect(all).not.toMatch(/greggs|briggate/i);
    expect(all).toContain("· from chat · Aisha is originally from Manchester.");
    expect(all).toContain("Aisha climbs about three times a week.");
    expect(all).toContain("Booked lunch at noon.");
    expect(listMemoryTopics(BOT).map((topic) => topic.name)).toEqual(["climbing.md"]);
  });

  it("logs no words from the turn that forgot, and hides chat titles that ask to forget or name what was forgotten", () => {
    writeMemoryFile(BOT, "- 2026-11-30 · Aisha takes sertraline 50mg, so mornings are foggy.\n- 2026-11-30 · Aisha prefers gentle morning reminders.\n");
    const about = { owner: aboutOwner(), text: "" };
    const aboutMe = createAboutMe({ read: () => "", write: () => {}, changed: () => {}, today: () => "2026-12-01" });
    const source = 'chat "actually can you forget the thing about my meds…"';
    expect(botMemoryUpdate(BOT, { action: "forget", oldText: "sertraline" }, { source, aboutMe, about })).toMatchObject({ ok: true });
    const now = new Date();
    appendMemoryLog(BOT, "I've forgotten your medication details. [tools: memory_update]", { source, now });
    appendMemoryLog(BOT, "Here is what I know: sertraline 50mg is gone.", { source: 'chat "what do you know"', now });
    const log = readMemoryLog(BOT, memoryLogPath(now).split("/").at(-1)!) ?? "";
    expect(log).toContain("· from chat · Forgot what the person asked to forget.");
    expect(log).not.toMatch(/meds|medication|sertraline/i);
    const hidden = correctedChatTitles("");
    expect(hidden("actually can you forget the thing about my meds…")).toBe(true);
    expect(hidden("random but i'm on sertraline 50mg and mornings …")).toBe(true);
    expect(hidden("lunch on friday")).toBe(false);
    expect(FORGET_ASK.test("don't forget the milk")).toBe(false);
  });
});
