import { describe, expect, it } from "vitest";
import { feedbackAnswer, whereWord } from "./feedback.ts";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleAppNotes } from "./ingest.ts";
import { createUsage, memoryUsageStore, type UsageRecord } from "./usage.ts";

const NOW = Date.UTC(2026, 10, 13, 12);
const base = { accountId: "acct_a", workspaceId: "ws_1" };
const records: UsageRecord[] = [
  { ...base, id: "frust00001", kind: "frustration", at: NOW - 3000, data: { id: "frust00001", at: NOW - 3000, engine: "claude", category: "email", tools: ["app"], apps: ["gmail"], signals: ["retried"], retries: 2,
    summary: "the bot kept failing to connect gmail and the person retried 3 times." } },
  { ...base, id: "session001", kind: "session", at: NOW - 2000, data: { id: "session001", at: NOW - 2000, engine: "codex", category: "coding", tools: ["terminal"], apps: ["github"], turns: 22, minutes: 50, failed: 1,
    summary: "a long coding session in the terminal; signing in to github took 2 tries." } },
  { ...base, id: "session002", kind: "session", at: NOW - 1000, data: { id: "session002", at: NOW - 1000, engine: "claude", category: "research", tools: ["browser"], apps: [], turns: 16, minutes: 30, failed: 0 } },
  { ...base, id: "digest0001", kind: "digest", at: NOW - 4000, data: { id: "digest0001", at: NOW - 4000, turns: 60, days: 5, summary: "they mostly use it for email and research; replies are sometimes slow." } },
  { ...base, id: "turn000001", kind: "turn", at: NOW - 500, data: { id: "turn000001", at: NOW - 500, engine: "claude", outcome: "ok", ms: 1000, tools: [], apps: [], category: "chat", from: "app", place: "desktop", room: false } },
];

describe("feedback view", () => {
  it("lists every kind of note newest first, never with a person, with friction themes first", async () => {
    const store = memoryUsageStore(() => NOW);
    await store.insert(records);
    const answer = await feedbackAnswer(store, { now: NOW, kind: null, before: null });
    expect(answer.notes.map(note => `${note.kind}:${note.id}`)).toEqual(["big:session002", "big:session001", "bad:frust00001", "weekly:digest0001"]);
    expect(answer.notes[0]!.text).toBeNull();
    expect(answer.notes.every(note => !("person" in note))).toBe(true);
    expect(answer.counts).toEqual({ bad: 1, big: 2, weekly: 1 });
    expect(answer.themes[0]!.pain).toBe(true);
    expect(answer.themes.map(theme => theme.key)).toContain("connecting");
  });
  it("counts every note of the window past one read's page, harness notes left out, several in one millisecond included", async () => {
    const store = memoryUsageStore(() => NOW);
    const many: UsageRecord[] = Array.from({ length: 1210 }, (_, i) => {
      const id = `frust${String(i).padStart(5, "0")}`, at = NOW - 10_000 - Math.floor(i / 3);
      return { ...base, ...(i < 10 ? { workspaceId: "qatest_ws" } : {}), id, kind: "frustration", at, data: { ...records[0]!.data, id, at } } as UsageRecord;
    });
    await store.insert(many);
    const answer = await feedbackAnswer(store, { now: NOW, kind: null, before: null, hidden: record => record.workspaceId.startsWith("qatest_") });
    expect(answer.counts.bad).toBe(1200);
    expect(answer.countsCapped).toBe(false);
  });
  it("says where a note ran and the app version when the record has them", async () => {
    const store = memoryUsageStore(() => NOW);
    await store.insert([{ ...records[0]!, ran: { place: "desktop", os: "mac", version: "0.2.15" } }, { ...records[1]!, ran: { place: "server", os: "vps" } }, { ...records[2]!, ran: { place: "cloud" } }]);
    const answer = await feedbackAnswer(store, { now: NOW, kind: null, before: null });
    const byId = Object.fromEntries(answer.notes.map(note => [note.id, note]));
    expect(byId.frust00001).toMatchObject({ where: "mac", version: "0.2.15", retries: 2 });
    expect(byId.session001).toMatchObject({ where: "own server" });
    expect(byId.session001!.version).toBeUndefined();
    expect(byId.session002).toMatchObject({ where: "cloud" });
    expect(whereWord({ place: "desktop" })).toBe("desktop");
  });
  it("filters by kind and pages with a cursor", async () => {
    const store = memoryUsageStore(() => NOW);
    await store.insert(records);
    const big = await feedbackAnswer(store, { now: NOW, kind: "big", before: null, limit: 1 });
    expect(big.notes.map(note => note.id)).toEqual(["session002"]);
    expect(big.next).toBe(NOW - 1000);
    const more = await feedbackAnswer(store, { now: NOW, kind: "big", before: big.next, limit: 1 });
    expect(more.notes.map(note => note.id)).toEqual(["session001"]);
    expect(more.next).toBeNull();
  });
  it("keeps an app's notes only from a signed-in account with notes on, under a hashed id with no account or workspace, and deletes them by id", async () => {
    const notesOn = new Set(["acct_yes"]);
    const store = memoryUsageStore(() => NOW), usage = createUsage({ store, now: () => NOW, optedOut: () => false, notesOn: id => notesOn.has(id) });
    const post = async (body: unknown, account: string | null = null) => {
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: "POST", headers: {} }) as unknown as IncomingMessage;
      let status = 0;
      const res = { writableEnded: false, writeHead(code: number) { status = code; }, end() {} } as unknown as ServerResponse;
      await handleAppNotes(req, res, { now: () => NOW, readBody: async r => Buffer.concat(await (r as unknown as Readable).toArray()), rate() {}, appAccount: () => account,
        save: (accountId, workspaceId, notes, ran) => usage.ingestNotes(accountId, workspaceId, notes, ran), forget: ids => usage.forgetShared(null, { notes: ids, records: false }) });
      return status;
    };
    const note = { id: "frust00009", at: NOW - 100, engine: "claude", category: "email", tools: ["app"], apps: ["gmail"], signals: ["retried"], retries: 2, summary: "gmail would not connect." };
    expect(await post({ install: "install_abcdefghijkl", platform: "darwin", version: "0.2.11", frustrations: [note] })).toBe(204);
    expect(await post({ install: "install_abcdefghijkl", frustrations: [{ ...note, id: "frust00010" }] }, "acct_no")).toBe(204);
    expect(await post({ install: "bad", frustrations: [note] })).toBe(400);
    await usage.ingest(null, "ws_unowned", { turns: [], runs: [], digests: [{ id: "digest0009", at: NOW - 50, turns: 40, days: 4, summary: "mostly email." }] });
    expect((await feedbackAnswer(store, { now: NOW, kind: null, before: null })).notes).toEqual([]);
    expect(await post({ install: "install_abcdefghijkl", platform: "darwin", version: "0.2.11", frustrations: [note] }, "acct_yes")).toBe(204);
    const [stored] = await store.records("frustration", 0, NOW + 1, 10);
    expect(stored).toMatchObject({ accountId: "", workspaceId: "" });
    expect(stored!.id).toMatch(/^note_/);
    expect(JSON.stringify(stored)).not.toContain("frust00009");
    expect(JSON.stringify(stored)).not.toContain("install_abcdefghijkl");
    const answer = await feedbackAnswer(store, { now: NOW, kind: null, before: null });
    expect(answer.notes).toHaveLength(1);
    expect(answer.notes[0]).toMatchObject({ kind: "bad", text: "gmail would not connect.", where: "mac", version: "0.2.11" });
    expect(await post({ install: "install_abcdefghijkl", forget: ["frust00009"] })).toBe(204);
    expect(await store.records("frustration", 0, NOW + 1, 10)).toEqual([]);
    expect(await post({ install: "install_abcdefghijkl", forget: ["no spaces allowed"] })).toBe(400);
  });
});
