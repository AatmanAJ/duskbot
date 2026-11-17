// Protocol 2 of the live stream: a bot the client already holds changes by a field patch instead of a whole frame.
// The server diffs each bot frame against the one it sent before; the client applies the patch to the bot it was last
// sent and gets back exactly the frame protocol 1 would have carried, so both protocols drive the same client code.

/** A JSON value as the stream carries it. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Fields = Record<string, unknown>;

/** What a bot frame carries that is not the bot: its open thread's newest page, sent when that thread changes. */
export const PAGE_KEYS = ["messages", "hasMore", "activeLeafId"] as const;

/** A thread the bot already had, with only what changed. */
export interface TaskChange {
  threadId: string;
  fields?: Fields;
  unset?: string[];
}

/** The bot's thread list: `order` is the whole list of thread ids whenever it changed; `add` holds the new threads in
 * full; a thread left out of `order` is gone. */
export interface TaskListPatch {
  order?: string[];
  add?: Fields[];
  change?: TaskChange[];
}

/**
 * `bot.patch`: the bot whose revision was `base` is now `rev`. `fields` hold whole new values of the bot's own keys,
 * `unset` the keys it no longer has; `tasks` changes its threads.
 */
export interface BotPatchFrame {
  kind: "bot.patch";
  id: string;
  base: number;
  rev: number;
  fields?: Fields;
  unset?: string[];
  tasks?: TaskListPatch;
}

/** `task.patch`: the one change was to one of the bot's threads. */
export interface TaskPatchFrame {
  kind: "task.patch";
  botId: string;
  base: number;
  rev: number;
  threadId: string;
  fields?: Fields;
  unset?: string[];
}

export type LivePatchFrame = BotPatchFrame | TaskPatchFrame;

/** A bot as a frame carries it: an id, a revision, and any other fields, threads included. */
export interface PatchableBot {
  id: string;
  rev?: number;
  tasks?: Array<{ threadId: string }>;
  [key: string]: unknown;
}

const defined = (value: unknown) => value !== undefined;

/** Equal as JSON: a key holding undefined is no key at all, as after a round trip through the stream. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i] === undefined ? null : a[i], b[i] === undefined ? null : b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  let count = 0;
  for (const key in left) {
    if (!defined(left[key])) continue;
    count++;
    if (!sameJson(left[key], right[key])) return false;
  }
  for (const key in right) if (defined(right[key])) count--;
  return count === 0;
}

/** What changed from `before` to `after`, key by key, leaving out `skip`. */
function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, skip: ReadonlySet<string>): { fields?: Fields; unset?: string[] } {
  let fields: Fields | undefined;
  let unset: string[] | undefined;
  for (const key in after) {
    if (skip.has(key) || !defined(after[key])) continue;
    if (!sameJson(before[key], after[key])) (fields ??= {})[key] = after[key];
  }
  for (const key in before) {
    if (skip.has(key) || !defined(before[key])) continue;
    if (!defined(after[key])) (unset ??= []).push(key);
  }
  return { ...(fields ? { fields } : {}), ...(unset ? { unset } : {}) };
}

const BOT_SKIP = new Set(["tasks", "rev", ...PAGE_KEYS]);
const NOTHING = new Set<string>();

function diffTasks(before: Array<Record<string, unknown> & { threadId: string }>, after: Array<Record<string, unknown> & { threadId: string }>): TaskListPatch | undefined {
  const prior = new Map(before.map((task) => [task.threadId, task]));
  const sameOrder = before.length === after.length && before.every((task, i) => task.threadId === after[i]!.threadId);
  const add: Fields[] = [];
  const change: TaskChange[] = [];
  for (const task of after) {
    const old = prior.get(task.threadId);
    if (!old) { add.push(task); continue; }
    const diff = diffFields(old, task, NOTHING);
    if (diff.fields || diff.unset) change.push({ threadId: task.threadId, ...diff });
  }
  if (sameOrder && !add.length && !change.length) return undefined;
  return { ...(sameOrder ? {} : { order: after.map((task) => task.threadId) }), ...(add.length ? { add } : {}), ...(change.length ? { change } : {}) };
}

/**
 * The patch from the frame last sent for a bot to its next one, or null when they hold the same bot. Both carry the
 * whole bot; neither carries a page (a frame with a page goes out whole).
 */
export function diffBotFrames(before: PatchableBot, after: PatchableBot, base: number, rev: number): LivePatchFrame | null {
  const own = diffFields(before, after, BOT_SKIP);
  const beforeTasks = before.tasks as Array<Fields & { threadId: string }> | undefined;
  const afterTasks = after.tasks as Array<Fields & { threadId: string }> | undefined;
  let tasks: TaskListPatch | undefined;
  if (Array.isArray(beforeTasks) && Array.isArray(afterTasks)) tasks = diffTasks(beforeTasks, afterTasks);
  else if (!sameJson(beforeTasks, afterTasks)) {
    if (defined(afterTasks)) (own.fields ??= {}).tasks = afterTasks;
    else (own.unset ??= []).push("tasks");
  }
  if (!own.fields && !own.unset && !tasks) return null;
  if (!own.fields && !own.unset && tasks && !tasks.order && !tasks.add && tasks.change?.length === 1) {
    const [only] = tasks.change;
    return { kind: "task.patch", botId: after.id, base, rev, threadId: only!.threadId, ...(only!.fields ? { fields: only!.fields } : {}), ...(only!.unset ? { unset: only!.unset } : {}) };
  }
  return { kind: "bot.patch", id: after.id, base, rev, ...own, ...(tasks ? { tasks } : {}) };
}

function patched<T extends Record<string, unknown>>(record: T, fields: Fields | undefined, unset: string[] | undefined): T {
  const next: Record<string, unknown> = { ...record };
  for (const key of unset ?? []) delete next[key];
  if (fields) Object.assign(next, fields);
  return next as T;
}

/** The id of the bot a patch frame changes. */
export const patchedBotId = (frame: LivePatchFrame): string => frame.kind === "bot.patch" ? frame.id : frame.botId;

/**
 * `bot` after `frame`, or null when `bot` is not the revision the patch was made from. Every thread the patch leaves
 * alone is the same object as before, so a client keeps the identity of what did not change.
 */
export function applyBotPatch<Bot extends PatchableBot>(bot: Bot, frame: LivePatchFrame): Bot | null {
  if (bot.rev !== frame.base || bot.id !== patchedBotId(frame)) return null;
  if (frame.kind === "task.patch") {
    const tasks = bot.tasks as Array<Fields & { threadId: string }> | undefined;
    const at = tasks?.findIndex((task) => task.threadId === frame.threadId) ?? -1;
    if (!tasks || at < 0) return null;
    const next = tasks.slice();
    next[at] = patched(tasks[at]!, frame.fields, frame.unset);
    return { ...bot, rev: frame.rev, tasks: next };
  }
  const next = patched(bot, frame.fields, frame.unset) as Bot;
  next.rev = frame.rev;
  const list = frame.tasks;
  if (!list) return next;
  const before = bot.tasks as Array<Fields & { threadId: string }> | undefined;
  if (!Array.isArray(before)) return null;
  const byThread = new Map(before.map((task) => [task.threadId, task]));
  for (const task of list.add ?? []) byThread.set(task.threadId as string, task as Fields & { threadId: string });
  for (const change of list.change ?? []) {
    const task = byThread.get(change.threadId);
    if (!task) return null;
    byThread.set(change.threadId, patched(task, change.fields, change.unset));
  }
  const order = list.order ?? before.map((task) => task.threadId);
  const tasks = order.map((threadId) => byThread.get(threadId));
  if (tasks.some((task) => task === undefined)) return null;
  next.tasks = tasks as NonNullable<PatchableBot["tasks"]>;
  return next;
}

/** A frame's bot as the client keeps it to patch: the bot, without the page some frames carry. */
export function patchBase<Bot extends PatchableBot>(bot: Bot): Bot {
  if (!PAGE_KEYS.some((key) => key in bot)) return bot;
  const base: Record<string, unknown> = { ...bot };
  for (const key of PAGE_KEYS) delete base[key];
  return base as Bot;
}

/**
 * The bots a client holds after one frame: a whole `bot` frame replaces (or adds) its bot, a patch changes the bot
 * whose revision it was made from. Null when a patch finds no such bot, so the caller reads the bot again.
 */
export function applyLiveBotFrame<Bot extends PatchableBot>(bots: Bot[], frame: { kind: string; [key: string]: unknown }): Bot[] {
  if (frame.kind === "bot") {
    const bot = patchBase(frame.bot as Bot);
    return bots.some((candidate) => candidate.id === bot.id) ? bots.map((candidate) => candidate.id === bot.id ? bot : candidate) : [bot, ...bots];
  }
  if (frame.kind === "bot.deleted") return bots.filter((candidate) => candidate.id !== frame.botId);
  if (frame.kind !== "bot.patch" && frame.kind !== "task.patch") return bots;
  const patch = frame as unknown as LivePatchFrame;
  const id = patchedBotId(patch);
  const current = bots.find((candidate) => candidate.id === id);
  if (current && typeof current.rev === "number" && patch.rev <= current.rev) return bots;
  const next = current ? applyBotPatch(current, patch) : null;
  if (!next) throw new Error(`live patch for bot ${id} does not apply to the revision held`);
  return bots.map((candidate) => candidate.id === id ? next : candidate);
}

export type { Json };
