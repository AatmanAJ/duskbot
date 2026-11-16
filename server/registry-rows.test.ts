import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { closeRegistryDbs, REGISTRY_DB_NAME } from "./registry-rows.ts";
import { Store } from "./store.ts";

const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });
const rows = (sql: string) => {
  const db = new DatabaseSync(join(DATA_DIR, REGISTRY_DB_NAME), { readOnly: true });
  try { return db.prepare(sql).all() as Array<Record<string, unknown>>; } finally { db.close(); }
};

beforeEach(() => {
  closeRegistryDbs();
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});

it("keeps one row per bot and per thread, and a thread change rewrites only that thread", () => {
  const store = new Store(selection);
  const bot = store.createBot({ name: "Rows" }, { seedMessages: false });
  const threads = Array.from({ length: 5 }, (_, i) => store.createTask(bot.id, `Thread ${i}`, false)!);
  expect(rows("SELECT thread_id FROM tasks").length).toBe(6);
  const before = new Map(rows("SELECT thread_id, json FROM tasks").map((row) => [row.thread_id, row.json]));
  store.patchTask(bot.id, threads[2]!.threadId, { title: "Only this one" });
  const after = new Map(rows("SELECT thread_id, json FROM tasks").map((row) => [row.thread_id, row.json]));
  const changed = [...after].filter(([threadId, json]) => before.get(threadId) !== json).map(([threadId]) => threadId);
  expect(changed).toEqual([threads[2]!.threadId]);
  store.deleteTask(bot.id, threads[0]!.threadId);
  expect(rows("SELECT thread_id FROM tasks").some((row) => row.thread_id === threads[0]!.threadId)).toBe(false);
});

it("never writes live turn state, and gives the rows owner-only permissions", () => {
  const store = new Store(selection);
  const bot = store.createBot({}, { seedMessages: false });
  store.setTaskActivity(bot.id, bot.threadId, "working");
  store.patchTask(bot.id, bot.threadId, { title: "Busy now" });
  const [task] = rows("SELECT json FROM tasks").map((row) => JSON.parse(String(row.json)));
  expect(task).toMatchObject({ title: "Busy now" });
  expect(task).not.toHaveProperty("busy");
  expect(task).not.toHaveProperty("activity");
  expect(task).not.toHaveProperty("turnStartedAt");
  const [own] = rows("SELECT json FROM bots").map((row) => JSON.parse(String(row.json)));
  expect(own).not.toHaveProperty("busy");
  expect(own).not.toHaveProperty("tasks");
});

it("reads the rows on a fresh install that crashed before bots.json caught up", () => {
  const store = new Store(selection);
  const bot = store.createBot({ name: "First" }, { seedMessages: false });
  store.createTask(bot.id, "Made before the crash", false);
  expect(new Store(selection).bot(bot.id)?.tasks?.map((task) => task.title)).toContain("Made before the crash");
});

it("starts from bots.json, not the rows, when the rows were never matched to it", () => {
  const store = new Store(selection);
  store.createBot({ name: "From rows" }, { seedMessages: false });
  writeFileSync(join(DATA_DIR, "bots.json"), "[]");
  expect(new Store(selection).bots).toEqual([]);
});
