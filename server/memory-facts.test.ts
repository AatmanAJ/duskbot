import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { annotateFact, factsOf, parseFactFile, syncAboutFacts, syncWorkspaceFacts } from "./memory-facts.ts";
import { closeMessageDb } from "./message-db.ts";
import { closeRegistryDbs } from "./registry-rows.ts";
import { writeMemoryFile, writeMemoryTopic, WORKSPACES_DIR } from "./workspace.ts";

const BOT = "facts-bot";
const TODAY = "2026-11-15";

beforeEach(() => {
  closeMessageDb(); closeRegistryDbs();
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
});

describe("reading facts out of a memory file", () => {
  it("takes dated entries with their state and the person's own lines, never headings or frontmatter", () => {
    const facts = parseFactFile("memory/trips.md", [
      "# Trips",
      "---",
      "title: Trips",
      "aliases: [travel, holidays]",
      "---",
      "- 2026-04-02 · from chat \"Plans\" (noticed) · Trip to Kyoto in April 2026 with Sam",
      "- 2026-01-05 · ~~Lives in Lisbon~~ · superseded 2026-06-10",
      "- 2026-09-20 · Staying in Goa · until 2026-09-25",
      "Prefers aisle seats",
      "```",
      "not a fact",
      "```",
    ].join("\n"), TODAY);
    expect(facts.map((f) => [f.text, f.status, f.typed])).toEqual([
      ["Trip to Kyoto in April 2026 with Sam", "active", false],
      ["Lives in Lisbon", "superseded", false],
      ["Staying in Goa", "expired", false],
      ["Prefers aisle seats", "active", true],
    ]);
    expect(facts[0]!.keys).toBe("trips Trips travel holidays");
    expect(facts[1]!.supersededOn).toBe("2026-06-10");
  });
});

describe("keeping rows in step with the files", () => {
  it("adds, follows a move between files, and marks a fact deleted by hand as suppressed", () => {
    writeMemoryFile(BOT, "- 2026-03-01 · Atlas deploys to Railway\n- 2026-03-02 · Sister Ana lives in Porto\n");
    syncWorkspaceFacts(BOT);
    const before = factsOf([BOT]);
    expect(before.map((f) => f.text).sort()).toEqual(["Atlas deploys to Railway", "Sister Ana lives in Porto"]);
    const ana = before.find((f) => f.text.includes("Ana"))!;
    annotateFact(BOT, "MEMORY.md", ana.text, { source: "person-said", quote: "my sister Ana moved to Porto" });

    writeMemoryFile(BOT, "- 2026-03-01 · Atlas deploys to Railway\n");
    writeMemoryTopic(BOT, "family.md", "- 2026-03-02 · Sister Ana lives in Porto\n");
    syncWorkspaceFacts(BOT);
    const moved = factsOf([BOT]).find((f) => f.text.includes("Ana"))!;
    expect(moved).toMatchObject({ id: ana.id, file: "memory/family.md", source: "person-said", trust: "high", quote: "my sister Ana moved to Porto" });

    writeMemoryTopic(BOT, "family.md", "");
    syncWorkspaceFacts(BOT);
    expect(factsOf([BOT]).map((f) => f.text)).toEqual(["Atlas deploys to Railway"]);
    expect(factsOf([BOT], ["suppressed"]).map((f) => f.id)).toEqual([ana.id]);
  });

  it("follows a supersede: the struck line keeps its row and gets the day it stopped holding", () => {
    writeMemoryFile(BOT, "- 2026-01-05 · The person lives in Lisbon\n");
    syncWorkspaceFacts(BOT);
    const [lisbon] = factsOf([BOT]);
    writeMemoryFile(BOT, "- 2026-01-05 · ~~The person lives in Lisbon~~ · superseded 2026-06-10\n- 2026-06-10 · The person lives in Porto\n");
    syncWorkspaceFacts(BOT);
    const old = factsOf([BOT], ["superseded"]);
    expect(old).toHaveLength(1);
    expect(old[0]).toMatchObject({ id: lisbon!.id, validFrom: "2026-01-05", validUntil: "2026-06-10" });
  });

  it("reads About me into its own owner, typed and learned lines told apart", () => {
    syncAboutFacts("about", "My name is Priya.\n- 2026-02-01 · learned by Scout · Plays the cello");
    const rows = factsOf(["about"]);
    expect(rows.map((f) => [f.text, f.source, f.trust])).toEqual([["My name is Priya.", "typed", "high"], ["Plays the cello", "legacy", "medium"]]);
    syncAboutFacts("about", "My name is Priya.");
    expect(factsOf(["about"]).map((f) => f.text)).toEqual(["My name is Priya."]);
  });
});
