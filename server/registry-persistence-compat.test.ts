import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { flushDeferredSaves } from "./save-batch.ts";
import { Store } from "./store.ts";

const selection = () => ({ instanceId: "claude", model: "claude-sonnet-5" });
const BOTS = () => join(DATA_DIR, "bots.json");

/** A bots.json as today's and older builds write it: whole bots, each with its threads in order. */
function legacyRegistry(now: number) {
  return [0, 1, 2].map((b) => ({
    id: `legacy-bot-${b}`, threadId: `legacy-${b}-t0`, name: `Legacy ${b}`, title: "", description: `Bot ${b}`, soul: "", notifications: true,
    color: "#6b5bd6", unread: false, modelSelection: selection(), resumeCursors: {}, createdAt: now - 10_000, cloudBackend: "vps",
    tasks: [0, 1, 2, 3].map((t) => ({
      threadId: `legacy-${b}-t${t}`, title: `Thread ${b}.${t}`, createdAt: now - 9_000 + t, updatedAt: now - 8_000 + t,
      resumeCursors: { claude: { sessionId: `s-${b}-${t}` } }, unread: false, ...(t === 2 ? { pinned: true } : {}),
    })),
  }));
}

/** Who owns what, in order, and the fields people change: what must survive every restart, upgrade and rollback. */
const shape = (bots: Array<{ id: string; name: string; threadId: string; tasks?: Array<{ threadId: string; title: string; pinned?: boolean; resumeCursors?: unknown }> }>) =>
  bots.map((bot) => ({ id: bot.id, name: bot.name, threadId: bot.threadId,
    tasks: (bot.tasks ?? []).map((task) => ({ threadId: task.threadId, title: task.title, pinned: Boolean(task.pinned), resumeCursors: task.resumeCursors ?? {} })) }));

const flushed = (store: Store) => {
  flushDeferredSaves();
  (store as unknown as { flushRegistry?: () => void }).flushRegistry?.call(store);
};

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});

it("loads a bots.json written by an earlier build, with every bot and thread in order", () => {
  const legacy = legacyRegistry(Date.now());
  writeFileSync(BOTS(), JSON.stringify(legacy));
  const store = new Store(selection);
  expect(shape(store.bots)).toEqual(shape(legacy));
  expect(shape(new Store(selection).bots)).toEqual(shape(legacy));
});

it("keeps every thread change across a restart that never flushed", () => {
  writeFileSync(BOTS(), JSON.stringify(legacyRegistry(Date.now())));
  const store = new Store(selection);
  store.patchTask("legacy-bot-1", "legacy-1-t3", { title: "Renamed thread" });
  store.patchTask("legacy-bot-0", "legacy-0-t1", { pinned: true });
  const created = store.createTask("legacy-bot-2", "Brand new", false)!;
  store.deleteTask("legacy-bot-0", "legacy-0-t2");
  store.patchBot("legacy-bot-1", { name: "Renamed bot" });
  store.reorderBots(["legacy-bot-2", "legacy-bot-0", "legacy-bot-1"]);
  store.setResumeCursor("legacy-bot-2", "claude", { sessionId: "fresh" }, created.threadId);
  const expected = shape(store.bots);
  expect(expected[0]!.id).toBe("legacy-bot-2");
  expect(expected[0]!.tasks[0]!.threadId).toBe(created.threadId);
  // a crash: nothing flushed, a fresh process reads what was saved
  expect(shape(new Store(selection).bots)).toEqual(expected);
});

it("leaves bots.json current after a clean shutdown, so an earlier build rolled back to reads the same bots", () => {
  writeFileSync(BOTS(), JSON.stringify(legacyRegistry(Date.now())));
  const store = new Store(selection);
  store.patchTask("legacy-bot-0", "legacy-0-t0", { title: "Before rollback" });
  const created = store.createTask("legacy-bot-0", "Made on this build", false)!;
  store.deleteTask("legacy-bot-1", "legacy-1-t1");
  flushed(store);
  const onDisk = JSON.parse(readFileSync(BOTS(), "utf8"));
  expect(Array.isArray(onDisk)).toBe(true);
  expect(shape(onDisk)).toEqual(shape(store.bots));
  expect(onDisk[0].tasks.some((task: { threadId: string }) => task.threadId === created.threadId)).toBe(true);
});

it("reads bots.json when something else replaced it: a restore, a hand edit, or an earlier build that ran in between", () => {
  writeFileSync(BOTS(), JSON.stringify(legacyRegistry(Date.now())));
  const store = new Store(selection);
  store.patchTask("legacy-bot-0", "legacy-0-t0", { title: "Written by this build" });
  flushed(store);
  // an earlier build runs, changes a title and writes its whole file
  const older = JSON.parse(readFileSync(BOTS(), "utf8"));
  older[0].tasks[0].title = "Written by the earlier build";
  older[1].name = "Renamed by the earlier build";
  writeFileSync(BOTS(), JSON.stringify(older));
  const after = new Store(selection);
  expect(after.taskByThread("legacy-bot-0", "legacy-0-t0")?.title).toBe("Written by the earlier build");
  expect(after.bot("legacy-bot-1")?.name).toBe("Renamed by the earlier build");
  // a restore that replaced the file without this build ever flushing
  const unflushed = new Store(selection);
  unflushed.patchTask("legacy-bot-2", "legacy-2-t0", { title: "Lost to the restore" });
  const restored = legacyRegistry(Date.now()).slice(0, 2);
  writeFileSync(BOTS(), JSON.stringify(restored));
  expect(shape(new Store(selection).bots)).toEqual(shape(restored));
});

it("starts empty, and stays empty, when there is no bots.json and nothing was ever saved", () => {
  expect(existsSync(BOTS())).toBe(false);
  expect(new Store(selection).bots).toEqual([]);
  expect(new Store(selection).bots).toEqual([]);
});
