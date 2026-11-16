import type { Bot, Group, Message } from "./store";

/** Normalized lookups over AppState's bots and groups. Built once per bots/groups array pair and reused. */
export interface StoreIndex {
  botsById: ReadonlyMap<string, Bot>;
  groupsById: ReadonlyMap<string, Group>;
  /** Every bot whose task list names the thread, in sidebar order. */
  botsByTaskThread: ReadonlyMap<string, readonly Bot[]>;
  /** The first bot whose open transcript is the thread. */
  botByOpenThread: ReadonlyMap<string, Bot>;
  /** The first group that has the thread open or among its tasks. */
  groupByThread: ReadonlyMap<string, Group>;
}

interface ThreadMaps {
  botsByTaskThread: Map<string, Bot[]>;
  botByOpenThread: Map<string, Bot>;
}

let lastBots: readonly Bot[] | null = null;
let lastGroups: readonly Group[] | null = null;
let lastIndex: StoreIndex | null = null;

const threadShape = (bot: Bot) => [bot.threadId, bot.tasks] as const;

/** True when no bot moved and none changed a field the thread maps read: they can be carried over with new bot objects. */
function sameThreadShape(previous: readonly Bot[], next: readonly Bot[]): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index++) {
    const before = previous[index]!, after = next[index]!;
    if (before === after) continue;
    if (before.id !== after.id) return false;
    const [threadA, tasksA] = threadShape(before), [threadB, tasksB] = threadShape(after);
    if (threadA !== threadB || tasksA !== tasksB) return false;
  }
  return true;
}

function botThreadMaps(bots: readonly Bot[]): ThreadMaps {
  const botsByTaskThread = new Map<string, Bot[]>();
  const botByOpenThread = new Map<string, Bot>();
  for (const bot of bots) {
    if (!botByOpenThread.has(bot.threadId)) botByOpenThread.set(bot.threadId, bot);
    for (const task of bot.tasks ?? []) {
      const owners = botsByTaskThread.get(task.threadId);
      if (owners) { if (owners.at(-1) !== bot) owners.push(bot); }
      else botsByTaskThread.set(task.threadId, [bot]);
    }
  }
  return { botsByTaskThread, botByOpenThread };
}

/** Carry the thread maps over to new bot objects of the same shape: only the changed bots are swapped in. */
function rebindThreadMaps(previous: StoreIndex, oldBots: readonly Bot[], bots: readonly Bot[]): ThreadMaps {
  const swapped = new Map<Bot, Bot>();
  for (let index = 0; index < bots.length; index++) if (oldBots[index] !== bots[index]) swapped.set(oldBots[index]!, bots[index]!);
  const botByOpenThread = new Map<string, Bot>();
  for (const [threadId, bot] of previous.botByOpenThread) botByOpenThread.set(threadId, swapped.get(bot) ?? bot);
  const botsByTaskThread = new Map<string, Bot[]>();
  for (const [threadId, owners] of previous.botsByTaskThread) {
    botsByTaskThread.set(threadId, owners.some((owner) => swapped.has(owner)) ? owners.map((owner) => swapped.get(owner) ?? owner) : owners as Bot[]);
  }
  return { botsByTaskThread, botByOpenThread };
}

function groupThreads(groups: readonly Group[]): Map<string, Group> {
  const byThread = new Map<string, Group>();
  for (const group of groups) {
    if (!byThread.has(group.threadId)) byThread.set(group.threadId, group);
    for (const task of group.tasks ?? []) if (!byThread.has(task.threadId)) byThread.set(task.threadId, group);
  }
  return byThread;
}

const NONE: readonly never[] = [];

export function storeIndex(state: { bots: readonly Bot[]; groups: readonly Group[] }): StoreIndex {
  // a test's partial state can leave either list out
  const bots = state.bots ?? NONE, groups = state.groups ?? NONE;
  if (lastIndex && bots === lastBots && groups === lastGroups) return lastIndex;
  const previous = lastIndex;
  let botsById = previous?.botsById as Map<string, Bot> | undefined;
  let threads: ThreadMaps | undefined;
  if (!previous || bots !== lastBots) {
    botsById = new Map(bots.map((bot) => [bot.id, bot]));
    threads = previous && lastBots && sameThreadShape(lastBots, bots) ? rebindThreadMaps(previous, lastBots, bots) : botThreadMaps(bots);
  }
  const groupsChanged = !previous || groups !== lastGroups;
  const index: StoreIndex = {
    botsById: botsById!,
    botsByTaskThread: threads?.botsByTaskThread ?? previous!.botsByTaskThread,
    botByOpenThread: threads?.botByOpenThread ?? previous!.botByOpenThread,
    groupsById: groupsChanged ? new Map(groups.map((group) => [group.id, group])) : previous!.groupsById,
    groupByThread: groupsChanged ? groupThreads(groups) : previous!.groupByThread,
  };
  lastBots = bots;
  lastGroups = groups;
  lastIndex = index;
  return index;
}

export const botById = (state: { bots: readonly Bot[]; groups: readonly Group[] }, id: string | null | undefined): Bot | undefined =>
  id ? storeIndex(state).botsById.get(id) : undefined;

export const groupById = (state: { bots: readonly Bot[]; groups: readonly Group[] }, id: string | null | undefined): Group | undefined =>
  id ? storeIndex(state).groupsById.get(id) : undefined;

/** The open transcript of a thread, a bot's or a group's: what `messagesByThread[threadId]` would hold. */
export function messagesByThread(state: { bots: readonly Bot[]; groups: readonly Group[] }, threadId: string): readonly Message[] | undefined {
  const index = storeIndex(state);
  const bot = index.botByOpenThread.get(threadId);
  if (bot) return bot.messages;
  const group = index.groupByThread.get(threadId);
  return group?.threadId === threadId ? group.messages : undefined;
}

interface Positions {
  ids: Map<string, number>;
  /** Positions below this are indexed. */
  length: number;
}

const positions = new WeakMap<readonly Message[], Positions>();
const RECENT = 16;
const recent: Array<readonly Message[]> = [];

/** An earlier indexed array whose every row is still in place (the same row, or a patched copy with its id): its
 * positions still hold, and only the rows after it need indexing. A pointer walk, far cheaper than building a map. */
function keepsRowsOf(messages: readonly Message[], earlier: readonly Message[]): boolean {
  if (!earlier.length || earlier.length > messages.length) return false;
  for (let index = 0; index < earlier.length; index++) {
    const before = earlier[index]!, after = messages[index]!;
    if (before !== after && before.id !== after.id) return false;
  }
  return true;
}

function indexedBase(messages: readonly Message[]): readonly Message[] | undefined {
  for (let index = recent.length - 1; index >= 0; index--) if (keepsRowsOf(messages, recent[index]!)) return recent[index];
  return undefined;
}

function positionsOf(messages: readonly Message[]): Positions {
  const known = positions.get(messages);
  if (known) return known;
  const earlier = indexedBase(messages);
  let found: Positions;
  if (earlier) {
    const shared = positions.get(earlier)!;
    for (let index = earlier.length; index < messages.length; index++) {
      const id = messages[index]!.id;
      if (!shared.ids.has(id)) shared.ids.set(id, index);
    }
    found = { ids: shared.ids, length: messages.length };
  } else {
    const ids = new Map<string, number>();
    for (let index = messages.length - 1; index >= 0; index--) ids.set(messages[index]!.id, index);
    found = { ids, length: messages.length };
  }
  positions.set(messages, found);
  recent.push(messages);
  if (recent.length > RECENT) recent.shift();
  return found;
}

/** findIndex by id, in O(1) once the transcript is indexed. */
export function messagePosition(messages: readonly Message[], id: string): number {
  if (messages.length < 16) return messages.findIndex((message) => message.id === id);
  const { ids } = positionsOf(messages);
  const at = ids.get(id);
  if (at === undefined) return -1;
  if (at < messages.length && messages[at]!.id === id) return at;
  return messages.findIndex((message) => message.id === id);
}

export const hasMessage = (messages: readonly Message[], id: string): boolean => messagePosition(messages, id) >= 0;

export function messageById(messages: readonly Message[], id: string): Message | undefined {
  const at = messagePosition(messages, id);
  return at < 0 ? undefined : messages[at];
}
