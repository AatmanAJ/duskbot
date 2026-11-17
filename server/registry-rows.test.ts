import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { closeRegistryDbs, readSavedBots, REGISTRY_DB_NAME } from "./registry-rows.ts";
import { flushDeferredSaves } from "./save-batch.ts";
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

it("loses nothing when registry.db is removed while the server runs", () => {
  const store = new Store(selection);
  const bots = [store.createBot({ name: "One" }, { seedMessages: false }), store.createBot({ name: "Two" }, { seedMessages: false })];
  closeRegistryDbs();
  for (const name of ["registry.db", "registry.db-wal", "registry.db-shm"]) rmSync(join(DATA_DIR, name), { force: true });
  store.patchTask(bots[0]!.id, bots[0]!.threadId, { title: "After the file went" });
  flushDeferredSaves();
  const after = new Store(selection);
  expect(after.bots.map((bot) => bot.name).sort()).toEqual(["One", "Two"]);
  expect(after.taskByThread(bots[0]!.id, bots[0]!.threadId)?.title).toBe("After the file went");
});

it("turns the rows off when they fail, saves bots.json whole, and starts from it next time", () => {
  const lines: string[] = [];
  const store = new Store(selection);
  const bot = store.createBot({ name: "Kept" }, { seedMessages: false });
  const rows = (store as unknown as { rows: { log: (line: string) => void; commit: () => void } }).rows;
  rows.log = (line) => lines.push(line);
  rows.commit = () => { throw new Error("disk I/O error"); };
  store.patchTask(bot.id, bot.threadId, { title: "Saved without rows" });
  expect(lines.join("\n")).toMatch(/failed and are off/);
  expect(JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8"))[0].tasks[0].title).toBe("Saved without rows");
  expect(new Store(selection).taskByThread(bot.id, bot.threadId)?.title).toBe("Saved without rows");
});

it("drops rows another writer left that bots.json no longer has", () => {
  const first = new Store(selection);
  const stray = first.createBot({ name: "Stray" }, { seedMessages: false });
  const second = new Store(selection);
  second.deleteBot(stray.id);
  first.createBot({ name: "Other" }, { seedMessages: false });
  const kept = new Store(selection).bots.map((bot) => bot.name);
  expect(kept).toContain("Other");
  const fresh = new Store(selection);
  expect(JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8")).map((bot: { name: string }) => bot.name)).toEqual(fresh.bots.map((bot) => bot.name));
});

it("reads the rows a server killed without closing left behind, while bots.json is behind", async () => {
  // A child process saves, then is killed with its database still open, as stopping a server on Windows does.
  const script = `
    process.env.DUSK_DATA_DIR = ${JSON.stringify(DATA_DIR)};
    const { Store } = await import(${JSON.stringify(new URL("./store.ts", import.meta.url).href)});
    const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
    const bot = store.createBot({ name: "Killed" }, { seedMessages: false });
    const task = store.createTask(bot.id, "Saved before the kill", false);
    process.stdout.write(JSON.stringify({ botId: bot.id, threadId: task.threadId }));
    process.kill(process.pid, "SIGKILL");`;
  const { spawnSync } = await import("node:child_process");
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, DUSK_DATA_DIR: DATA_DIR } });
  const { botId, threadId } = JSON.parse(run.stdout) as { botId: string; threadId: string };
  expect(readFileSync(join(DATA_DIR, "bots.json"), "utf8")).not.toContain(threadId);
  const saved = readSavedBots<{ id: string; tasks: Array<{ threadId: string; title: string }> }>(DATA_DIR);
  expect(saved.find((bot) => bot.id === botId)?.tasks.find((task) => task.threadId === threadId)?.title).toBe("Saved before the kill");
});
