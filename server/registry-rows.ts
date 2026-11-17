// The bot registry kept one row per bot and per thread (registry.db), so a thread change writes that thread's row and
// not the whole registry. bots.json stays the file everything else reads (backups, moves, the sentinel, earlier builds
// after a rollback): a full save rewrites it, and a thread change schedules one a moment later. The database records
// the hash of the bots.json it last wrote, and is used at start only when that file is still there unchanged; any other
// bots.json (a restore, a hand edit, an earlier build that ran in between) is read and becomes the rows.
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  /** A new number each time the file is opened: a reopened file may not hold what was written to the old one. */
  generation: number;
}

const connections = new Map<string, Connection>();
let opened = 0;

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
  const connection = { db, statements: new Map<string, StatementSync>(), generation: ++opened };
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
 * differ, in one transaction. The rows are never the only copy: any failure to read or write them turns them off for
 * the rest of the run, and every save then writes bots.json whole, as before they existed.
 */
export class RegistryRows<Bot, Task> {
  private readonly file: string;
  private readonly shape: RegistryShape<Bot, Task>;
  private readonly log: (line: string) => void;
  private written = new Map<string, WrittenBot>();
  private order: string[] = [];
  private generation = 0;
  private off = false;

  constructor(file: string, shape: RegistryShape<Bot, Task>, log: (line: string) => void = (line) => console.warn(line)) {
    this.file = file;
    this.shape = shape;
    this.log = log;
  }

  /**
   * The bots to start with: the rows, when the database last wrote the very bots.json `read` found, or when that file
   * could not be read at all; otherwise the file's own records, which then replace the rows. `fromRows` says which.
   */
  load(read: RegistryRead<Bot>): { bots: Bot[]; fromRows: boolean } {
    const hash = read.state === "loaded" ? registryFileHash(read.text) : read.state === "missing" ? registryFileHash(null) : UNREADABLE;
    try {
      // a bots.json that could not be read gives way to rows that last matched a good one
      const rows = this.readRows(hash === UNREADABLE ? null : hash);
      if (rows && (hash !== UNREADABLE || rows.length)) return { bots: rows, fromRows: true };
      this.replace(read.records, hash);
    } catch (error) {
      this.turnOff(error);
    }
    return { bots: read.records, fromRows: false };
  }

  /**
   * One bot's rows, after a change to it or its threads. `durable` waits for the disk itself, as a permission must.
   * False when the rows cannot take it alone (they are off, or the file was replaced): the caller saves everything.
   */
  writeBot(bots: readonly Bot[], bot: Bot, durable: boolean): boolean {
    if (this.off) return false;
    try {
      if (connect(this.file).generation !== this.generation) return false;
      const changes = new Changes();
      this.diffBot(bot, changes);
      const ids = bots.map(this.shape.idOf);
      if (!sameList(ids, this.order)) changes.order = ids;
      this.commit(changes, durable);
      return true;
    } catch (error) {
      this.turnOff(error);
      return false;
    }
  }

  /** Every row, as bots.json is about to hold `text`. */
  writeAll(bots: readonly Bot[], text: string): void {
    if (this.off) return;
    try {
      const changes = new Changes();
      // rows this process never wrote (another writer, a replaced file) are rewritten from scratch
      if (connect(this.file).generation !== this.generation || !this.holdsOnlyWritten()) {
        changes.clear = true;
        this.written = new Map();
        this.order = [];
        this.generation = connect(this.file).generation;
      }
      const ids = bots.map(this.shape.idOf);
      for (const bot of bots) this.diffBot(bot, changes);
      for (const id of this.written.keys()) if (!ids.includes(id)) changes.removeBots.push(id);
      if (!sameList(ids, this.order)) changes.order = ids;
      changes.mirror = registryFileHash(text);
      this.commit(changes, true);
    } catch (error) {
      this.turnOff(error);
    }
  }

  /** Off for the rest of the run; the rows stop matching any bots.json, so the next start reads the file. */
  private turnOff(error: unknown): void {
    if (this.off) return;
    this.off = true;
    this.log(`[store] the registry's rows (${REGISTRY_DB_NAME}) failed and are off until restart; bots.json is saved whole: ${(error as Error).message}`);
    try { this.statement("DELETE FROM meta WHERE key = 'mirror'").run(); } catch { /* the next bots.json written no longer matches them anyway */ }
  }

  private holdsOnlyWritten(): boolean {
    const counts = this.statement("SELECT (SELECT COUNT(*) FROM bots) AS bots, (SELECT COUNT(*) FROM tasks) AS tasks").get() as { bots: number; tasks: number };
    let tasks = 0;
    for (const bot of this.written.values()) tasks += bot.tasks.size;
    return Number(counts.bots) === this.written.size && Number(counts.tasks) === tasks;
  }

  /** The rows, when they last matched the bots.json whose hash is `hash`; with null, whatever they last matched. */
  private readRows(hash: string | null): Bot[] | null {
    const read = readRowsMatching(connect(this.file).db, hash);
    if (!read) return null;
    this.written = read.written;
    this.order = read.order;
    this.generation = connect(this.file).generation;
    return read.bots as Bot[];
  }

  private replace(bots: readonly Bot[], hash: string): void {
    const changes = new Changes();
    changes.clear = true;
    this.written = new Map();
    this.order = [];
    for (const bot of bots) this.diffBot(bot, changes);
    changes.order = bots.map(this.shape.idOf);
    changes.mirror = hash;
    this.generation = connect(this.file).generation;
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

/** The rows whose recorded bots.json has this hash (null: whatever file they last matched), as the start reads them. */
function readRowsMatching(db: DatabaseSync, hash: string | null): { bots: unknown[]; written: Map<string, WrittenBot>; order: string[] } | null {
  const get = (key: string) => (db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  const mirror = get("mirror");
  if (mirror === undefined || (hash !== null && mirror !== hash)) return null;
  const order = JSON.parse(get("order") ?? "[]") as string[];
  const botRows = new Map((db.prepare("SELECT id, json, threads FROM bots").all() as Array<{ id: string; json: string; threads: string }>).map((row) => [row.id, row]));
  const taskRows = new Map<string, Map<string, string>>();
  for (const row of db.prepare("SELECT bot_id, thread_id, json FROM tasks").all() as Array<{ bot_id: string; thread_id: string; json: string }>) {
    let list = taskRows.get(row.bot_id);
    if (!list) taskRows.set(row.bot_id, list = new Map());
    list.set(row.thread_id, row.json);
  }
  const ids = [...order.filter((id) => botRows.has(id)), ...[...botRows.keys()].filter((id) => !order.includes(id))];
  const bots: unknown[] = [];
  const written = new Map<string, WrittenBot>();
  for (const id of ids) {
    const row = botRows.get(id)!;
    const threads = JSON.parse(row.threads) as string[] | null;
    const rows = taskRows.get(id) ?? new Map<string, string>();
    const bot = JSON.parse(row.json) as Record<string, unknown>;
    if (threads) bot.tasks = threads.filter((threadId) => rows.has(threadId)).map((threadId) => JSON.parse(rows.get(threadId)!));
    bots.push(bot);
    written.set(id, { json: row.json, threads, tasks: rows });
  }
  return { bots, written, order: ids };
}

/**
 * The registry a server starting on `dataDir` now would read: the rows while they match its bots.json, otherwise that
 * file. Read-only, and safe beside a running server; for tools and tests that look at a data folder from outside.
 */
export function readSavedBots<Bot = Record<string, unknown>>(dataDir: string): Bot[] {
  let text: string | null = null;
  try { text = readFileSync(join(dataDir, "bots.json"), "utf8"); } catch { /* none yet */ }
  const fromFile = (): Bot[] => {
    if (text === null) return [];
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed as Bot[] : [];
  };
  const file = join(dataDir, REGISTRY_DB_NAME);
  if (!existsSync(file)) return fromFile();
  let db: DatabaseSync;
  try { db = new DatabaseSync(file, { readOnly: true }); } catch { return fromFile(); }
  try {
    return (readRowsMatching(db, registryFileHash(text))?.bots as Bot[] | undefined) ?? fromFile();
  } catch {
    return fromFile();
  } finally {
    db.close();
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
