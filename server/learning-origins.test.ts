import { describe, expect, it } from "vitest";

import { createLearningOrigins, ROUTINE_CAPTURE_GAP_MS, type LearningOriginsDeps } from "./learning-origins.ts";
import { capturePrompt, statedInConversation, type CaptureTurn } from "./memory-capture.ts";

type Message = ReturnType<LearningOriginsDeps["path"]>[number];

function setup(threads: Record<string, Message[]>, options: { routine?: string; dryRun?: boolean; webhook?: boolean; heartbeat?: string; unattended?: boolean; api?: string } = {}) {
  let clock = 1_000_000;
  const origins = createLearningOrigins({
    path: (threadId) => threads[threadId] ?? [],
    routineRun: (threadId) => threadId === options.routine ? { routineId: "r1", routineName: "Price watch", ...(options.dryRun ? { dryRun: true as const } : {}), ...(options.webhook ? { triggerSource: "webhook" } : {}) } : null,
    heartbeat: (threadId) => threadId === options.heartbeat,
    internal: (threadId) => threadId === "internal",
    apiThread: (threadId) => threadId === options.api,
    unattended: () => options.unattended === true,
    now: () => clock,
  });
  return { origins, advance: (ms: number) => { clock += ms; } };
}

const ask = (text: string, extra: Partial<Message> = {}): Message => ({ id: `u-${text.length}`, role: "user", kind: "text", text, ...extra });
const tool = (turnId: string, ok = true): Message => ({ id: `a-${turnId}`, role: "bot", kind: "activity", turnId, tool: { name: "web_fetch", ok } as Message["tool"] });
const reply = (turnId: string, text: string, extra: Partial<Message> = {}): Message => ({ id: `b-${turnId}`, role: "bot", kind: "text", turnId, text, ...extra });

describe("which turns feed memory and skills", () => {
  it("reads a person's turn as their words", () => {
    const { origins } = setup({ t: [ask("I moved to Lisbon last week"), reply("1", "Nice, noted.")] });
    expect(origins.captureTurn("b", "t", "1")).toMatchObject({ person: "I moved to Lisbon last week", bot: "Nice, noted.", owner: true });
  });

  it("lets a routine run feed memory only with a verified outcome, never as the person, at most once per gap", () => {
    const run = [ask("Check the flight price to Tokyo. Last report: 612 EUR."), tool("1"), reply("1", "The fare dropped to 540 EUR on the airline's site.")];
    const { origins, advance } = setup({ r: run }, { routine: "r" });
    const turn = origins.captureTurn("b", "r", "1");
    expect(turn).toMatchObject({ person: "", owner: false, origin: { kind: "routine", name: "Price watch" } });
    expect(origins.captureTurn("b", "r", "1")).toBeNull();
    advance(ROUTINE_CAPTURE_GAP_MS);
    expect(origins.captureTurn("b", "r", "1")).not.toBeNull();
    expect(setup({ r: [ask("Check"), reply("1", "Nothing new.")] }, { routine: "r" }).origins.captureTurn("b", "r", "1")).toBeNull();
    expect(setup({ r: [ask("Check"), tool("1"), reply("1", "NOTHING NEW", { quietRun: true })] }, { routine: "r" }).origins.captureTurn("b", "r", "1")).toBeNull();
    expect(setup({ r: run }, { routine: "r", dryRun: true }).origins.captureTurn("b", "r", "1")).toBeNull();
    // a webhook's or app event's run carries outside words: it teaches neither memory nor skills
    expect(setup({ r: run }, { routine: "r", webhook: true }).origins.captureTurn("b", "r", "1")).toBeNull();
    expect(setup({ r: run }, { routine: "r", webhook: true }).origins.countsForSkills("r")).toBe(false);
    expect(setup({ a: run }, { api: "a" }).origins.countsForSkills("a")).toBe(false);
  });

  it("never reads the day watch, harness turns or a turn nobody opened", () => {
    const thread = [ask("Look over today"), tool("1"), reply("1", "All quiet.")];
    expect(setup({ w: thread }, { heartbeat: "w" }).origins.captureTurn("b", "w", "1")).toBeNull();
    expect(setup({ internal: thread }).origins.captureTurn("b", "internal", "1")).toBeNull();
    expect(setup({ t: thread }, { unattended: true }).origins.captureTurn("b", "t", "1")).toBeNull();
    expect(setup({ w: thread }, { heartbeat: "w" }).origins.countsForSkills("w")).toBe(false);
    expect(setup({ r: thread }, { routine: "r", dryRun: true }).origins.countsForSkills("r")).toBe(false);
    expect(setup({ r: thread }, { routine: "r" }).origins.countsForSkills("r")).toBe(true);
  });

  it("reads another bot's hand-off as that bot's words, kept only with a verified outcome", () => {
    const peerAsk = { botId: "forge", name: "Forge" };
    const { origins } = setup({ h: [ask("Deploy Atlas to staging", { peerAsk }), tool("1"), reply("1", "Atlas 2.4 is live on staging; health check passed.")] });
    expect(origins.captureTurn("b", "h", "1")).toMatchObject({ person: "", owner: false, origin: { kind: "bot", name: "Forge" } });
    expect(setup({ h: [ask("Deploy", { peerAsk }), reply("1", "Sure, will do")] }).origins.captureTurn("b", "h", "1")).toBeNull();
  });
});

describe("capture grounding for turns no person opened", () => {
  const routine: CaptureTurn = { person: "", bot: "The fare dropped to 540 EUR. Last report: 612 EUR.", owner: false,
    origin: { kind: "routine", name: "Price watch", asked: "Check the price. Last report: 612 EUR." } };

  it("keeps an outcome the bot verified and refuses what only repeats its instruction or claims the person said it", () => {
    expect(statedInConversation({ text: "The Tokyo fare dropped to 540 EUR", kind: "outcome", aboutUser: false, evidence: "The fare dropped to 540 EUR" }, [routine], false)).toBe(true);
    expect(statedInConversation({ text: "The fare was 612 EUR", kind: "outcome", aboutUser: false, evidence: "Last report: 612 EUR" }, [routine], false)).toBe(false);
    expect(statedInConversation({ text: "The person watches Tokyo fares", kind: "fact", aboutUser: false, evidence: "Check the price" }, [routine], false)).toBe(false);
  });

  it("names the routine as an instruction, never as the person", () => {
    const prompt = capturePrompt({ botName: "Scout", turns: [routine], notebook: "", today: "2026-11-25" });
    expect(prompt).toContain('Routine "Price watch" (a saved automation\'s instruction, not the Person): Check the price.');
    expect(prompt).not.toContain("Person: Check the price");
    expect(prompt).toContain("A turn opened by a Routine or by another bot has no words of the Person in it");
  });
});
