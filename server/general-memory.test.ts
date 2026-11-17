import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { createAboutMe } from "./about-me.ts";
import { DATA_DIR } from "./config.ts";
import {
  applyNotebookChange, CONSOLIDATE_MARKER, consolidatePrompt, generalForPrompt, listGeneralHistory, namesFact, parseConsolidation,
  parseGeneral, planConsolidation, recordGeneralHistory, restoreGeneralHistory, withoutLearnedFacts, type NotebookLine,
} from "./general-memory.ts";
import { capturePrompt, parseCandidates, CAPTURE_MARKER } from "./memory-capture.ts";
import { parseMemoryEntries } from "./memory-entries.ts";
import { createMemoryUpkeep, type UpkeepBot, type UpkeepEngine } from "./memory-upkeep.ts";
import { closeMessageDb } from "./message-db.ts";
import { closeRegistryDbs } from "./registry-rows.ts";
import { buildRecall } from "./recall.ts";
import { listLearnedFacts } from "./profile-learned.ts";
import { ensureWorkspace, readMemoryTopic, workspaceDir, writeMemoryFile, writeMemoryTopic, WORKSPACES_DIR } from "./workspace.ts";

const TODAY = "2026-11-14";
const learned = (date: string, by: string, fact: string) => `- ${date} · learned by ${by} · ${fact}`;
const notebookLines = (botId: string, botName: string, text: string): NotebookLine[] =>
  parseMemoryEntries(text).filter((entry) => !entry.struck).map((entry) => ({ botId, botName, entry }));

beforeEach(() => {
  closeMessageDb(); closeRegistryDbs();
  rmSync(DATA_DIR, { recursive: true, force: true });
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
});

describe("what loads each turn", () => {
  it("is the same text when everything fits, so the cached prompt stays the same", () => {
    const text = `I work at Fernhill.\n${learned("2026-11-01", "Scout", "Prefers short replies")}`;
    expect(generalForPrompt(text)).toEqual({ text, omitted: [] });
  });

  it("keeps the person's own lines and health facts, then the newest learned lines within the budget", () => {
    const text = [
      "My name is Priya.",
      learned("2026-01-01", "Scout", "Is allergic to peanuts"),
      learned("2026-02-01", "Scout", "Likes long walks on Sundays"),
      learned("2026-03-01", "Scout", "Plays the cello"),
      learned("2026-04-01", "Forge", "Prefers dark mode everywhere"),
    ].join("\n");
    const { text: loaded, omitted } = generalForPrompt(text, 120);
    expect(loaded).toContain("My name is Priya.");
    expect(loaded).toContain("allergic to peanuts");
    expect(loaded).toContain("dark mode");
    expect(omitted.map((line) => line.fact)).toEqual(["Likes long walks on Sundays", "Plays the cello"]);
  });

  it("recalls a left-out fact when the message shares its words, and nothing loaded twice", async () => {
    const text = [learned("2026-03-01", "Scout", "Plays the cello every Sunday"), learned("2026-02-01", "Scout", "Likes long walks"), learned("2026-04-01", "Scout", "Prefers dark mode")].join("\n");
    const recall = (message: string, loaded: string[] = []) =>
      buildRecall({ botId: "gm-recall", message, threadIds: [], label: () => "", author: () => "", about: { owner: "about", text }, loaded, today: TODAY });
    const cello = (await recall("any good cello teachers near me?"))?.text ?? "";
    expect(cello).toContain("about the person");
    expect(cello).toContain("Plays the cello every Sunday");
    expect(cello).not.toContain("long walks");
    expect(await recall("what's the weather in town today")).toBeNull();
    expect((await recall("is dark mode on everywhere?", [text]))?.text ?? "").not.toContain("Prefers dark mode");
  });
});

describe("consolidation plan", () => {
  const general = (text: string) => parseGeneral(text);

  it("parses only ids that exist", () => {
    expect(parseConsolidation('```json\n{"same":[{"drop":"G2","keep":"G1"},{"drop":"G9","keep":"G1"}],"replaced":[{"old":"g1","new":"B1","remainder":"x"}],"promote":["B1","G1","B7"]}\n```', { general: 2, notebooks: 1 }))
      .toEqual({ same: [{ drop: "G2", keep: "G1" }], replaced: [{ old: "G1", new: "B1", remainder: "x" }], promote: ["B1"] });
    expect(parseConsolidation("no json", { general: 1, notebooks: 1 })).toBeNull();
  });

  it("drops a learned duplicate, never the person's own line, and lets the newer fact win", () => {
    const text = ["Prefers short replies", learned("2026-11-01", "Scout", "Prefers short replies, as the person said"), learned("2026-11-01", "Scout", "Lives in Lisbon"), learned("2026-11-10", "Scout", "Lives in Porto now")].join("\n");
    const lines = general(text);
    const plan = planConsolidation(lines, [], {
      same: [{ drop: "G1", keep: "G2" }],
      replaced: [{ old: "G3", new: "G4" }, { old: "G4", new: "G3" }],
      promote: [],
    }, { text, today: TODAY, promote: true });
    expect(plan.text).toBe(["Prefers short replies", learned("2026-11-10", "Scout", "Lives in Porto now")].join("\n"));
    expect(plan.removed.map((entry) => [entry.reason, entry.fact])).toEqual([["duplicate", "Prefers short replies, as the person said"], ["replaced", "Lives in Lisbon"]]);
  });

  it("removes a bot's copy of a general fact, strikes a bot's older fact, and lifts a lasting one into general memory", () => {
    const text = [learned("2026-11-01", "Scout", "Is vegetarian"), learned("2026-11-10", "Scout", "Wants detailed answers")].join("\n");
    const notebook = [
      '- 2026-11-01 · from chat "Hi" · Is vegetarian',
      '- 2026-11-01 · from chat "Hi" · Wants short answers',
      '- 2026-11-02 · from chat "Hi" · Her sister Asha is at asha@example.com',
      '- 2026-11-02 · from room "Launch" · Milind lives in Goa',
      '- 2026-11-03 · from chat "Atlas" · Atlas deploys to Railway',
    ].join("\n");
    const notes = notebookLines("scout", "Scout", notebook);
    const plan = planConsolidation(general(text), notes, {
      same: [{ drop: "G1", keep: "B1" }],
      replaced: [{ old: "B2", new: "G2" }],
      promote: ["B3", "B4"],
    }, { text, today: TODAY, promote: true });
    expect(plan.added.map((entry) => entry.fact)).toEqual(["Her sister Asha is at asha@example.com"]);
    expect(plan.text).toContain(learned(TODAY, "Scout", "Her sister Asha is at asha@example.com"));
    const after = applyNotebookChange(notebook, parseMemoryEntries(notebook), plan.notebooks.get("scout")!, TODAY);
    expect(after.split("\n")).toEqual([
      `- 2026-11-01 · from chat "Hi" · ~~Wants short answers~~ · superseded ${TODAY}`,
      '- 2026-11-02 · from room "Launch" · Milind lives in Goa',
      '- 2026-11-03 · from chat "Atlas" · Atlas deploys to Railway',
    ]);
  });

  it("moves nothing out of a bot's notes where several people use the bots", () => {
    const text = learned("2026-11-01", "Scout", "Lives in Lisbon");
    const notes = notebookLines("scout", "Scout", '- 2026-11-10 · from chat "Hi" · Lives in Porto');
    const plan = planConsolidation(general(text), notes, { same: [], replaced: [{ old: "G1", new: "B1" }], promote: ["B1"] }, { text, today: TODAY, promote: false });
    expect(plan.text).toBe(text);
    expect(plan.notebooks.size).toBe(0);
  });

  it("takes out at most a third of the learned lines and one of the person's own in one pass", () => {
    const text = ["Lives in Pune", "Works at Fernhill", ...Array.from({ length: 6 }, (_, i) => learned("2026-11-10", "Scout", `fact ${i}`))].join("\n");
    const lines = general(text);
    const plan = planConsolidation(lines, [], {
      same: [{ drop: "G3", keep: "G4" }, { drop: "G5", keep: "G6" }, { drop: "G7", keep: "G8" }],
      replaced: [{ old: "G1", new: "G3" }, { old: "G2", new: "G4" }],
      promote: [],
    }, { text, today: TODAY, promote: true });
    expect(plan.removed.filter((entry) => !entry.raw.includes("learned by"))).toHaveLength(1);
    expect(plan.removed.filter((entry) => entry.raw.includes("learned by"))).toHaveLength(2);
  });

  it("trims the oldest learned lines past the size budget, never a health fact", () => {
    const text = [learned("2026-01-01", "Scout", "Is allergic to peanuts"), learned("2026-02-01", "Scout", "Likes jazz"), learned("2026-03-01", "Scout", "Plays the cello")].join("\n");
    const plan = planConsolidation(general(text), [], { same: [], replaced: [], promote: [] }, { text, today: TODAY, promote: true, maxChars: 110 });
    expect(plan.removed.map((entry) => [entry.reason, entry.fact])).toEqual([["trimmed", "Likes jazz"]]);
    expect(plan.text).toContain("peanuts");
  });

  it("asks only for promotion where it is allowed", () => {
    const prompt = consolidatePrompt({ general: general(learned("2026-11-01", "Scout", "Lives in Porto")), notebooks: [], promote: false, today: TODAY });
    expect(prompt).toContain(CONSOLIDATE_MARKER);
    expect(prompt).toContain("G1 (2026-11-01) Lives in Porto");
    expect(prompt).not.toContain("promote");
  });
});

describe("replacing a fact", () => {
  it("names the old line however the model copies it", () => {
    const names = namesFact(["Priya lives in Lisbon."]);
    expect(names("Priya lives in Lisbon")).toBe(true);
    expect(names("Priya lives in Lisbon · updated 2026-11-02")).toBe(true);
    expect(names("Priya lives in Porto")).toBe(false);
    expect(namesFact(["in"])("lives in Lisbon")).toBe(false);
  });

  it("takes the replaced learned line out of About me, keeps the person's own lines, and keeps the old one in the history", () => {
    let text = ["Lives in Lisbon", learned("2026-11-01", "Scout", "Priya lives in Lisbon")].join("\n");
    const aboutMe = createAboutMe({ read: () => text, write: (next) => { text = next; }, changed: () => undefined, today: () => TODAY });
    expect(aboutMe.learn({ botId: "scout", botName: "Scout" }, ["Priya lives in Porto"], ["Priya lives in Lisbon"])).toBe(1);
    expect(text).toBe(["Lives in Lisbon", learned(TODAY, "Scout", "Priya lives in Porto")].join("\n"));
    const history = listGeneralHistory();
    expect(history).toMatchObject([{ fact: "Priya lives in Lisbon", reason: "replaced", by: "Priya lives in Porto" }]);
    expect(listLearnedFacts().map((fact) => fact.text)).toEqual(["Priya lives in Porto"]);

    const restored = restoreGeneralHistory(history[0]!.id, text)!;
    expect(restored.aboutMe).toContain(learned("2026-11-01", "Scout", "Priya lives in Lisbon"));
    expect(listGeneralHistory()).toEqual([]);
    expect(restoreGeneralHistory(history[0]!.id, text)).toBeNull();
  });

  it("leaves About me alone when the old line is not there", () => {
    const text = learned("2026-11-01", "Scout", "Is vegetarian");
    expect(withoutLearnedFacts(text, ["Lives in Lisbon"])).toEqual({ text, removed: [] });
  });

  it("the capture step sees the general memory and may name what a fact replaces", () => {
    const prompt = capturePrompt({ botName: "Scout", turns: [{ person: "I moved to Porto", bot: "Nice" }], notebook: "", today: TODAY, general: "- Priya lives in Lisbon" });
    expect(prompt).toContain(CAPTURE_MARKER);
    expect(prompt).toContain("general memory, which all of their assistants read, already holds these lines");
    expect(prompt).toContain("- Priya lives in Lisbon");
    expect(parseCandidates(JSON.stringify([{ text: "Priya lives in Porto", kind: "fact", aboutUser: true, evidence: "I moved to Porto", replaces: "- Priya lives in Lisbon" }]), TODAY))
      .toEqual([{ text: "Priya lives in Porto", kind: "fact", aboutUser: true, evidence: "I moved to Porto", replaces: "Priya lives in Lisbon" }]);
  });
});

describe("the upkeep loop with a general memory", () => {
  const SCOUT: UpkeepBot = { id: "bot-general-scout", name: "Scout" };
  const FORGE: UpkeepBot = { id: "bot-general-forge", name: "Forge" };
  let about: string;
  let answers: string[];
  let prompts: string[];

  const loop = (promote = true) => {
    const engine: UpkeepEngine = { generateText: async (prompt) => { prompts.push(prompt); return answers.shift() ?? "[]"; } };
    const aboutMe = createAboutMe({ read: () => about, write: (next) => { about = next; }, changed: () => undefined, today: () => TODAY });
    return createMemoryUpkeep({
      bots: () => [SCOUT, FORGE],
      bot: (id) => [SCOUT, FORGE].find((bot) => bot.id === id),
      engine: () => engine,
      busy: () => false,
      addToAboutMe: (from, texts, replaces) => aboutMe.learn(from, texts, replaces),
      general: { read: () => about, write: (next) => { about = next; }, changed: () => undefined, promote: () => promote },
      sourceLabel: () => 'chat "Plans"',
      quietMs: () => 60_000,
      tidyHour: () => 3,
      now: () => new Date(2026, 10, 14, 10, 0),
    });
  };

  beforeEach(() => {
    about = "";
    answers = [];
    prompts = [];
  });

  it("files a fact about the person once, in general memory, and strikes the bot's older note it replaces", async () => {
    ensureWorkspace(SCOUT.id);
    about = learned("2026-11-01", "Scout", "Priya prefers short replies");
    writeMemoryFile(SCOUT.id, '- 2026-11-01 · from chat "Hi" · Priya prefers short replies\n');
    writeMemoryTopic(SCOUT.id, "asha.md", '- 2026-11-01 · from chat "Hi" · Asha\'s email is asha.rao@example.com\n');
    answers.push(JSON.stringify([
      { text: "Priya prefers detailed, thorough answers", kind: "preference", evidence: "I want detailed, thorough answers", aboutUser: true, replaces: "Priya prefers short replies", confidence: 0.9 },
      { text: "Asha's email is asha@raoclinic.in", kind: "fact", evidence: "it's asha@raoclinic.in now", topic: "asha", replaces: "Asha's email is asha.rao@example.com", confidence: 0.9 },
    ]));
    const report = await loop().capture({ botId: SCOUT.id, threadId: "t1", turns: [{ person: "From now on I want detailed, thorough answers. Asha's email: it's asha@raoclinic.in now.", bot: "Got it." }] });
    expect(prompts[0]).toContain("- Priya prefers short replies");
    expect(report).toMatchObject({ added: 0, topics: 1, aboutMe: 1 });
    expect(about).toBe(learned(TODAY, "Scout", "Priya prefers detailed, thorough answers"));
    const notes = readFileSync(join(workspaceDir(SCOUT.id), "MEMORY.md"), "utf8");
    expect(notes).toContain(`~~Priya prefers short replies~~ · superseded ${TODAY}`);
    expect(notes).not.toContain("detailed");
    const topic = readMemoryTopic(SCOUT.id, "asha.md")!;
    expect(topic).toContain(`~~Asha's email is asha.rao@example.com~~ · superseded ${TODAY}`);
    expect(topic).toContain("Asha's email is asha@raoclinic.in");
  });

  it("consolidates general memory with every bot's notes, newest wins, and keeps what it took out", async () => {
    ensureWorkspace(SCOUT.id);
    ensureWorkspace(FORGE.id);
    about = [learned("2026-11-01", "Scout", "Lives in Lisbon"), learned("2026-11-01", "Scout", "Is vegetarian")].join("\n");
    writeMemoryFile(SCOUT.id, '- 2026-11-01 · from chat "Hi" · Is vegetarian\n- 2026-11-10 · from chat "Move" · Lives in Porto now\n');
    writeMemoryFile(FORGE.id, '- 2026-11-02 · from chat "Atlas" · Atlas deploys to Railway\n');
    answers.push(JSON.stringify({ same: [{ drop: "B3", keep: "G2" }], replaced: [{ old: "G1", new: "B1" }], promote: [] }));
    const report = await loop().consolidateGeneral();
    expect(prompts[0]).toContain(CONSOLIDATE_MARKER);
    // each bot's notes are shared out in turn, newest first, so one bot with many notes cannot crowd the others out
    expect(prompts[0]).toContain("B1 (Scout, 2026-11-10) Lives in Porto now\nB2 (Forge, 2026-11-02) Atlas deploys to Railway\nB3 (Scout, 2026-11-01) Is vegetarian");
    expect(report).toMatchObject({ removed: 1, promoted: 1, notes: 2 });
    expect(about).toBe([learned("2026-11-01", "Scout", "Is vegetarian"), learned(TODAY, "Scout", "Lives in Porto now")].join("\n"));
    expect(readFileSync(join(workspaceDir(SCOUT.id), "MEMORY.md"), "utf8").trim()).toBe("");
    expect(readFileSync(join(workspaceDir(FORGE.id), "MEMORY.md"), "utf8")).toContain("Atlas deploys to Railway");
    expect(listGeneralHistory()).toMatchObject([{ fact: "Lives in Lisbon", reason: "replaced", by: "Lives in Porto now" }]);
    expect(listLearnedFacts().map((fact) => fact.text)).toEqual(["Lives in Porto now"]);
  });

  it("does not write over general memory the person changed while the model was answering", async () => {
    ensureWorkspace(SCOUT.id);
    about = [learned("2026-11-01", "Scout", "Lives in Lisbon"), learned("2026-11-10", "Scout", "Lives in Porto")].join("\n");
    const upkeep = loop();
    answers.push(JSON.stringify({ same: [], replaced: [{ old: "G1", new: "G2" }], promote: [] }));
    const running = upkeep.consolidateGeneral();
    about = `${about}\nTyped by the person`;
    expect((await running).note).toMatch(/changed meanwhile/);
    expect(about).toContain("Lives in Lisbon");
  });

  it("records nothing in the history when nothing was taken out", () => {
    recordGeneralHistory([]);
    expect(listGeneralHistory()).toEqual([]);
  });
});
