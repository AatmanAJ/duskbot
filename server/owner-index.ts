/** What the index needs of a bot or a room: its id, its open thread and its threads. */
export interface IndexedOwner {
  id: string;
  threadId: string;
  tasks?: ReadonlyArray<{ threadId: string }>;
}

/** Where a thread sits: its owner's position, and the thread's position in that owner's list (-1: only the open thread). */
interface ThreadSlot {
  owner: number;
  task: number;
}

export interface ThreadHit<Owner> {
  owner: Owner;
  /** The thread's position in `owner.tasks`, or -1 when only the owner's open thread names it. */
  task: number;
}

/**
 * Lookups by id and by thread over a list of owners that the store changes in place. A hit proves itself against the
 * live list (that owner, or that thread, still sits where the index says), so a stale index never answers a wrong
 * record. A miss is trusted only while every owner still has the list of threads and the open thread it was built
 * with, a check per owner and never per thread. Either failure rebuilds once and answers again.
 *
 * Ids and thread ids are unique across owners; with `DUSK_REGISTRY_SHADOW=1` every answer is compared with a
 * front-to-back search and a difference throws, which is how the test suite holds both claims.
 */
export class OwnerIndex<Owner extends IndexedOwner> {
  private readonly read: () => readonly Owner[];
  private built = false;
  private owners: Owner[] = [];
  private taskLists: Array<IndexedOwner["tasks"]> = [];
  private taskCounts: number[] = [];
  private openThreads: string[] = [];
  private ids = new Map<string, number>();
  private threads = new Map<string, ThreadSlot>();
  private readonly shadow = process.env.DUSK_REGISTRY_SHADOW === "1";

  constructor(read: () => readonly Owner[]) {
    this.read = read;
  }

  byId(id: string): Owner | undefined {
    const list = this.read();
    const found = this.findId(list, id);
    if (this.shadow) expectSame(found, list.find((owner) => owner.id === id), `owner ${id}`);
    return found;
  }

  /** The owner whose open thread or one of whose threads is `threadId`. */
  byThread(threadId: string): Owner | undefined {
    return this.thread(threadId)?.owner;
  }

  thread(threadId: string): ThreadHit<Owner> | undefined {
    const list = this.read();
    const found = this.findThread(list, threadId);
    if (this.shadow) {
      expectSame(found?.owner, list.find((owner) => owner.threadId === threadId || owner.tasks?.some((task) => task.threadId === threadId)), `thread ${threadId}`);
      if (found && found.task >= 0) expectSame(found.owner.tasks?.[found.task], found.owner.tasks?.find((task) => task.threadId === threadId), `thread ${threadId}'s record`);
    }
    return found;
  }

  /** For a change no list's length or identity shows, like two threads swapping places. */
  invalidate(): void {
    this.built = false;
  }

  private findId(list: readonly Owner[], id: string): Owner | undefined {
    const at = this.ids.get(id);
    if (at !== undefined && list[at]?.id === id) return list[at];
    if (at === undefined && this.unchanged(list)) return undefined;
    this.rebuild(list);
    const fresh = this.ids.get(id);
    return fresh === undefined ? undefined : list[fresh];
  }

  private findThread(list: readonly Owner[], threadId: string): ThreadHit<Owner> | undefined {
    const slot = this.threads.get(threadId);
    if (slot && this.holds(list, slot, threadId)) return { owner: list[slot.owner]!, task: this.taskSlot(list[slot.owner]!, slot, threadId) };
    if (!slot && this.unchanged(list)) return undefined;
    this.rebuild(list);
    const fresh = this.threads.get(threadId);
    return fresh ? { owner: list[fresh.owner]!, task: fresh.task } : undefined;
  }

  private holds(list: readonly Owner[], slot: ThreadSlot, threadId: string): boolean {
    const owner = list[slot.owner];
    if (!owner) return false;
    return slot.task < 0 ? owner.threadId === threadId : owner.tasks?.[slot.task]?.threadId === threadId;
  }

  private taskSlot(owner: Owner, slot: ThreadSlot, threadId: string): number {
    if (slot.task >= 0) return slot.task;
    return owner.tasks?.findIndex((task) => task.threadId === threadId) ?? -1;
  }

  /** Every owner is the one built from, with the same list of threads (by identity and length) and the same open thread. */
  private unchanged(list: readonly Owner[]): boolean {
    if (!this.built || list.length !== this.owners.length) return false;
    for (let i = 0; i < list.length; i++) {
      const owner = list[i]!;
      if (owner !== this.owners[i] || owner.tasks !== this.taskLists[i] || (owner.tasks?.length ?? -1) !== this.taskCounts[i] || owner.threadId !== this.openThreads[i]) return false;
    }
    return true;
  }

  private rebuild(list: readonly Owner[]): void {
    this.built = true;
    this.owners = [...list];
    this.taskLists = list.map((owner) => owner.tasks);
    this.taskCounts = list.map((owner) => owner.tasks?.length ?? -1);
    this.openThreads = list.map((owner) => owner.threadId);
    this.ids = new Map();
    this.threads = new Map();
    list.forEach((owner, at) => {
      if (!this.ids.has(owner.id)) this.ids.set(owner.id, at);
      owner.tasks?.forEach((task, index) => {
        if (!this.threads.has(task.threadId)) this.threads.set(task.threadId, { owner: at, task: index });
      });
      if (!this.threads.has(owner.threadId)) this.threads.set(owner.threadId, { owner: at, task: -1 });
    });
  }
}

function expectSame<T>(indexed: T | undefined, searched: T | undefined, what: string): void {
  if (indexed !== searched) throw new Error(`registry index disagrees with a search for ${what}`);
}
