// The bot registry kept one row per bot and per thread (registry.db), so a thread change writes that thread's row and
// not the whole registry. bots.json stays the file everything else reads (backups, moves, the sentinel, earlier builds
// after a rollback): a full save rewrites it, and a thread change schedules one a moment later. The database records
// the hash of the bots.json it last wrote, and is used at start only when that file is still there unchanged; any other
// bots.json (a restore, a hand edit, an earlier build that ran in between) is read and becomes the rows.
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import type { RegistryRead } from "./registry-file.ts";

export const REGISTRY_DB_NAME = "registry.db";
/** The database and its write-ahead files: left out of backups and moves (bots.json carries the registry there) and
 * hidden from engines, since thread rows hold provider session ids. */
export const REGISTRY_DB_FILES = [REGISTRY_DB_NAME, `${REGISTRY_DB_NAME}-wal`, `${REGISTRY_DB_NAME}-shm`] as const;

/** The hash recorded for "there was no bots.json"; a file that could not be read matches nothing. */
const NO_FILE = "none";
const UNREADABLE = "unreadable";
export const registryFileHash = (text: string | null): string => text === null ? NO_FILE : createHash("sha256").update(text).digest("hex");

interface Connection {
  db: DatabaseSync;
  statements: Map<string, StatementSync>;
}

const connections = new Map<string, Connection>();

function connect(file: string): Connection {
  const held = connections.get(file);
  // A folder removed under an open database (a reset, a test) would take later writes into an unlinked file.
  if (held && existsSync(file)) return held;
  if (held) {
    try { held.db.close(); } catch { /* already closed */ }
    connections.delete(file);
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // Thread rows hold provider session ids: owner-only, repairing a permissive umask on an existing file too.
  closeSync(openSync(file, "a", 0o600));
  try { chmodSync(file, 0o600); } catch { /* windows has no modes */ }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, json TEXT NOT NULL, threads TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (bot_id TEXT NOT NULL, thread_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (bot_id, thread_id));`);
  const connection = { db, statements: new Map<string, StatementSync>() };
  connections.set(file, connection);
  return connection;
}

/** Windows will not remove a folder that holds an open database: tests close them before each reset. */
export function closeRegistryDbs(): void {
  for (const { db } of connections.values()) {
    try { db.close(); } catch { /* already closed */ }
  }
  connections.clear();
}

/** What a bot and its threads look like on disk, as JSON text per row. */
interface WrittenBot {
  json: string;
  /** The thread ids in order, or null for a bot that has no list. */
  threads: string[] | null;
  tasks: Map<string, string>;
}

/** The registry's fields that never reach the disk: live state that every start clears. */
export interface RegistryShape<Bot, Task> {
  botRow: (bot: Bot) => string;
  taskRow: (task: Task) => string;
  tasksOf: (bot: Bot) => Task[] | undefined;
  idOf: (bot: Bot) => string;
  threadOf: (task: Task) => string;
}

/**
 * The rows of one bots.json. Every write compares against what this process last wrote and sends only the rows that
 * differ, in one transaction.
 */
export class RegistryRows<Bot, Task> {
  private readonly file: string;
  private readonly shape: RegistryShape<Bot, Task>;
  private written = new Map<string, WrittenBot>();
  private order: string[] = [];

  constructor(file: string, shape: RegistryShape<Bot, Task>) {
    this.file = file;
    this.shape = shape;
  }

  /**
   * The bots to start with: the rows, when the database last wrote the very bots.json `read` found; otherwise the
   * file's own records, which then replace the rows. `fromRows` says which.
   */
  load(read: RegistryRead<Bot>): { bots: Bot[]; fromRows: boolean } {
    const hash = read.state === "loaded" ? registryFileHash(read.text) : read.state === "missing" ? registryFileHash(null) : UNREADABLE;
    const rows = hash === UNREADABLE ? null : this.readRows(hash);
    if (rows) return { bots: rows, fromRows: true };
    this.replace(read.records, hash);
    return { bots: read.records, fromRows: false };
  }

  /** One bot's rows, after a change to it or its threads. `durable` waits for the disk itself, as a permission must. */
  writeBot(bots: readonly Bot[], bot: Bot, durable: boolean): void {
    const changes = new Changes();
    this.diffBot(bot, changes);
    const ids = bots.map(this.shape.idOf);
    if (!sameList(ids, this.order)) changes.order = ids;
    this.commit(changes, durable);
  }

  /** Every row, with bots.json now holding `text`. */
  writeAll(bots: readonly Bot[], text: string): void {
    const changes = new Changes();
    const ids = bots.map(this.shape.idOf);
    for (const bot of bots) this.diffBot(bot, changes);
    for (const id of this.written.keys()) if (!ids.includes(id)) changes.removeBots.push(id);
    if (!sameList(ids, this.order)) changes.order = ids;
    changes.mirror = registryFileHash(text);
    this.commit(changes, true);
  }

  private readRows(hash: string): Bot[] | null {
    const get = (key: string) => (this.statement("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
    if (get("mirror") !== hash) return null;
    const order = JSON.parse(get("order") ?? "[]") as string[];
    const botRows = new Map((this.statement("SELECT id, json, threads FROM bots").all() as Array<{ id: string; json: string; threads: string }>).map((row) => [row.id, row]));
    const taskRows = new Map<string, Map<string, string>>();
    for (const row of this.statement("SELECT bot_id, thread_id, json FROM tasks").all() as Array<{ bot_id: string; thread_id: string; json: string }>) {
      let list = taskRows.get(row.bot_id);
      if (!list) taskRows.set(row.bot_id, list = new Map());
      list.set(row.thread_id, row.json);
    }
    const ids = [...order.filter((id) => botRows.has(id)), ...[...botRows.keys()].filter((id) => !order.includes(id))];
    const bots: Bot[] = [];
    this.written = new Map();
    for (const id of ids) {
      const row = botRows.get(id)!;
      const threads = JSON.parse(row.threads) as string[] | null;
      const rows = taskRows.get(id) ?? new Map<string, string>();
      const bot = JSON.parse(row.json) as Record<string, unknown>;
      if (threads) bot.tasks = threads.filter((threadId) => rows.has(threadId)).map((threadId) => JSON.parse(rows.get(threadId)!));
      bots.push(bot as Bot);
      this.written.set(id, { json: row.json, threads, tasks: rows });
    }
    this.order = ids;
    return bots;
  }

  private replace(bots: readonly Bot[], hash: string): void {
    const changes = new Changes();
    changes.clear = true;
    this.written = new Map();
    this.order = [];
    for (const bot of bots) this.diffBot(bot, changes);
    changes.order = bots.map(this.shape.idOf);
    changes.mirror = hash;
    this.commit(changes, false);
  }

  private diffBot(bot: Bot, changes: Changes): void {
    const id = this.shape.idOf(bot);
    const before = this.written.get(id);
    const tasks = this.shape.tasksOf(bot);
    const json = this.shape.botRow(bot);
    const threads = tasks ? tasks.map(this.shape.threadOf) : null;
    const rows = new Map<string, string>();
    for (const task of tasks ?? []) {
      const threadId = this.shape.threadOf(task);
      const row = this.shape.taskRow(task);
      rows.set(threadId, row);
      if (before?.tasks.get(threadId) !== row) changes.tasks.push({ botId: id, threadId, json: row });
    }
    for (const threadId of before?.tasks.keys() ?? []) if (!rows.has(threadId)) changes.removeTasks.push({ botId: id, threadId });
    if (!before || before.json !== json || !sameList(before.threads, threads)) changes.bots.push({ id, json, threads });
    changes.after.set(id, { json, threads, tasks: rows });
  }

  private commit(changes: Changes, durable: boolean): void {
    if (!changes.any()) return;
    const { db } = connect(this.file);
    if (durable) {
      db.exec("PRAGMA synchronous = FULL");
      // SQLite's own fsync leaves macOS's drive cache unflushed; the atomic file writes it stands in for use F_FULLFSYNC.
      if (process.platform === "darwin") db.exec("PRAGMA fullfsync = ON");
    }
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (changes.clear) {
          this.statement("DELETE FROM bots").run();
          this.statement("DELETE FROM tasks").run();
        }
        for (const id of changes.removeBots) {
          this.statement("DELETE FROM bots WHERE id = ?").run(id);
          this.statement("DELETE FROM tasks WHERE bot_id = ?").run(id);
        }
        for (const bot of changes.bots) {
          this.statement("INSERT INTO bots (id, json, threads) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, threads = excluded.threads")
            .run(bot.id, bot.json, JSON.stringify(bot.threads));
        }
        for (const task of changes.removeTasks) this.statement("DELETE FROM tasks WHERE bot_id = ? AND thread_id = ?").run(task.botId, task.threadId);
        for (const task of changes.tasks) {
          this.statement("INSERT INTO tasks (bot_id, thread_id, json) VALUES (?, ?, ?) ON CONFLICT(bot_id, thread_id) DO UPDATE SET json = excluded.json")
            .run(task.botId, task.threadId, task.json);
        }
        if (changes.order) this.setMeta("order", JSON.stringify(changes.order));
        if (changes.mirror !== undefined) this.setMeta("mirror", changes.mirror);
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* nothing open */ }
        throw error;
      }
    } finally {
      if (durable) {
        db.exec("PRAGMA synchronous = NORMAL");
        if (process.platform === "darwin") db.exec("PRAGMA fullfsync = OFF");
      }
    }
    // Only what reached the disk counts as written.
    for (const id of changes.removeBots) this.written.delete(id);
    for (const [id, bot] of changes.after) this.written.set(id, bot);
    if (changes.order) this.order = changes.order;
  }

  private setMeta(key: string, value: string): void {
    this.statement("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  private statement(sql: string): StatementSync {
    const connection = connect(this.file);
    let prepared = connection.statements.get(sql);
    if (!prepared) connection.statements.set(sql, prepared = connection.db.prepare(sql));
    return prepared;
  }
}

class Changes {
  clear = false;
  order: string[] | undefined;
  mirror: string | undefined;
  bots: Array<{ id: string; json: string; threads: string[] | null }> = [];
  removeBots: string[] = [];
  tasks: Array<{ botId: string; threadId: string; json: string }> = [];
  removeTasks: Array<{ botId: string; threadId: string }> = [];
  after = new Map<string, WrittenBot>();

  any(): boolean {
    return this.clear || this.order !== undefined || this.mirror !== undefined || this.bots.length > 0 || this.removeBots.length > 0 ||
      this.tasks.length > 0 || this.removeTasks.length > 0;
  }
}

function sameList(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
