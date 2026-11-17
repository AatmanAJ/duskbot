// How the bot registry is laid out on disk: what of a bot and of a thread is kept, and the rows that hold them.
import { join } from "node:path";

import { REGISTRY_DB_NAME, RegistryRows } from "./registry-rows.ts";
import type { BotRecord, TaskRecord } from "./store.ts";

/** How long after a thread's own row write bots.json is rewritten to match (at most once per this, while changes go on). */
export const BOTS_FILE_FOLLOWS_MS = 2_000;

export function persistedPin<T extends { pinned?: boolean }>(task: T): T {
  if (task.pinned === true) return task;
  if (!("pinned" in task)) return task;
  const { pinned: _pinned, ...rest } = task;
  return rest as T;
}

/** A thread as the disk keeps it: no live turn state, and a pin only when set. */
export function persistedTask({ busy: _busy, activity: _activity, turnStartedAt: _turnStartedAt, ...task }: TaskRecord) {
  return persistedPin(task);
}

/** The registry's rows in `dataDir`: one per bot (without its threads or live state) and one per thread. */
export function botRegistryRows(dataDir: string): RegistryRows<BotRecord, TaskRecord> {
  return new RegistryRows<BotRecord, TaskRecord>(join(dataDir, REGISTRY_DB_NAME), {
    idOf: (bot) => bot.id,
    tasksOf: (bot) => bot.tasks,
    threadOf: (task) => task.threadId,
    botRow: ({ busy: _busy, activity: _activity, tasks: _tasks, ...bot }) => JSON.stringify(bot),
    taskRow: (task) => JSON.stringify(persistedTask(task)),
  });
}
