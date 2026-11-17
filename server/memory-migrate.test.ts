import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { aboutOwner, factsOf } from "./memory-facts.ts";
import { BACKUP_DIR, MIGRATION_FILE, migrateMemory } from "./memory-migrate.ts";
import { closeMessageDb } from "./message-db.ts";
import { closeRegistryDbs } from "./registry-rows.ts";
import { appendMemoryLog, workspaceDir, writeMemoryFile, writeMemoryTopic, WORKSPACES_DIR } from "./workspace.ts";

beforeEach(() => {
  closeMessageDb(); closeRegistryDbs();
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
});

const MEMORY = [
  "# Memory",
  "",
  "Durable notes, written by hand.",
  "- 2026-01-05 · from chat \"Intro\" (noticed) · ~~Lives in Lisbon~~ · superseded 2026-06-10",
  "- 2026-06-10 · Lives in Porto",
  "- 2026-09-20 · Staying in Goa · until 2026-09-25",
  "- 2026-03-01 · Deploy script:",
  "  ```sh",
  "  pnpm deploy",
  "  ```",
  "- Prefers metric units",
].join("\n");

it("copies every file as it was, reads every line into the store once, and never rewrites the files", () => {
  writeMemoryFile("bot-a", `${MEMORY}\n`);
  writeMemoryTopic("bot-a", "trips.md", "---\ntitle: Trips\naliases: [travel]\n---\n- 2026-04-02 · Kyoto in April 2026 with Sam\n- 2026-07-01 · Lisbon weekend\n");
  writeMemoryTopic("bot-a", "archive.md", "- 2026-01-01 · Old gym day was Monday · moved 2026-05-01\n");
  writeMemoryTopic("bot-b", "atlas.md", "- 2026-02-01 · Atlas deploys to Railway\n");
  appendMemoryLog("bot-a", "a log line, not a fact");
  const aboutMe = "My name is Priya.\n- 2026-02-01 · learned by Scout · Plays the cello\n- 2026-03-01 · learned by Scout · Plays the cello";
  const before = readFileSync(join(workspaceDir("bot-a"), "MEMORY.md"), "utf8");

  const report = migrateMemory(DATA_DIR, { botIds: ["bot-a", "bot-b"], aboutMe, now: new Date(2026, 10, 15) })!;
  expect(report.lines).toBe(report.facts);
  expect(report.lines).toBe(6 + 2 + 1 + 1 + 2);
  expect(readFileSync(join(workspaceDir("bot-a"), "MEMORY.md"), "utf8")).toBe(before);
  expect(readFileSync(join(report.backup, "workspaces", "bot-a", "MEMORY.md"), "utf8")).toBe(before);
  expect(existsSync(join(report.backup, "workspaces", "bot-a", "memory", "trips.md"))).toBe(true);
  expect(existsSync(join(report.backup, "workspaces", "bot-a", "memory", "log"))).toBe(false);
  expect(readFileSync(join(report.backup, "about-me.md"), "utf8")).toBe(aboutMe);
  expect(report.backup.startsWith(join(DATA_DIR, BACKUP_DIR))).toBe(true);

  const rows = factsOf(["bot-a"], ["active", "superseded", "expired"]);
  expect(rows.find((row) => row.text === "Lives in Lisbon")?.status).toBe("superseded");
  expect(rows.find((row) => row.text === "Staying in Goa")?.status).toBe("expired");
  expect(rows.find((row) => row.text === "Prefers metric units")?.source).toBe("typed");
  expect(rows.find((row) => row.text.startsWith("Kyoto"))).toMatchObject({ happenedStart: "2026-04-01", happenedEnd: "2026-04-30" });
  expect(factsOf([aboutOwner()]).map((row) => row.text)).toEqual(["My name is Priya.", "Plays the cello"]);

  expect(migrateMemory(DATA_DIR, { botIds: ["bot-a"], aboutMe, now: new Date() })).toBeNull();
  expect(JSON.parse(readFileSync(join(DATA_DIR, MIGRATION_FILE), "utf8"))).toMatchObject({ lines: report.lines, facts: report.facts });
});
