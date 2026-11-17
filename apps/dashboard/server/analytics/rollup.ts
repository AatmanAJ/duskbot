// The admin's analytics read pre-built digests for closed hours and days and raw events only for the edges of a window
// (its first partial hour and the hour still open). A digest is a fold over events in time order that can be merged with
// the digest of the time after it, so a window read from digests equals the same fold over the raw events.
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import type { AnalyticsSink, StoredEvent } from "./sink.ts";
import { RAW_RETENTION_DAYS } from "./events.ts";

/** Maps and Sets as JSON, for the small digests */
export function pack(value: unknown): unknown {
  if (value instanceof Map) return { $m: [...value].map(([key, item]) => [key, pack(item)]) };
  if (value instanceof Set) return { $s: [...value] };
  if (Array.isArray(value)) return value.map(pack);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pack(item)]));
  return value;
}
export function unpack(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unpack);
  if (value && typeof value === "object") {
    if ("$m" in value) return new Map((value.$m as Array<[unknown, unknown]>).map(([key, item]) => [key, unpack(item)]));
    if ("$s" in value) return new Set(value.$s as unknown[]);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
  }
  return value;
}

export const HOUR = 3_600_000, DAY = 86_400_000;
const zip = promisify(gzip), unzip = promisify(gunzip);
/** under MongoDB's 16 MB document limit; a slot whose digest is bigger is not stored and is read from its hours or raw */
const MAX_DOC_BYTES = 15 * 1024 * 1024;

export interface Digest<P> {
  kind: string;
  /** bumped when the digest's shape or meaning changes: older stored digests are rebuilt */
  version: number;
  /** the events it reads */
  names: readonly string[];
  empty(): P;
  /** one event, in time order */
  add(into: P, event: StoredEvent): void;
  /** folds the digest of a later time into `into` */
  merge(into: P, later: P): void;
  encode(digest: P): unknown;
  decode(json: unknown): P;
}

/** whose events a digest folds: a source's events, without those `drops` names (test accounts, harness installs) */
export interface RollupScope {
  /** where the events come from ("own" or "live"), plus "~clean" when `drops` filters them */
  key: string;
  /** the unfiltered events */
  sink: AnalyticsSink;
  /** the accounts whose events `drops` removes; a stored digest stays good while the hidden accounts among its events are the same */
  hidden: ReadonlySet<string> | null;
  drops: ((event: StoredEvent) => boolean) | null;
}

export interface RollupDoc {
  scope: string; kind: string; slot: string; at: number; v: number;
  /** a stamp taken before its events were read: a dirty mark newer than it means the digest missed something */
  builtAt: number;
  /** the slot's raw events when it was built, for spotting late or removed events */
  count: number;
  /** with `hidden`: every account among the slot's events, and the hidden ones among them when it was built */
  accounts?: string[]; hiddenHere?: string[];
  data: Uint8Array;
}
export type RollupMeta = Omit<RollupDoc, "data">;

export interface RollupStore {
  read(scope: string, kind: string, slots: readonly string[]): Promise<RollupDoc[]>;
  meta(scope: string, slots: readonly string[]): Promise<RollupMeta[]>;
  write(docs: RollupDoc[]): Promise<void>;
  /** the newest dirty stamp of each slot (and of "*", the whole source) */
  marks(source: string, slots: readonly string[]): Promise<Map<string, number>>;
  mark(source: string, slots: readonly string[], stamp: number): Promise<void>;
}

/** an hour slot is "h:" and its start, a day slot "d:" and its start (UTC) */
export const hourSlot = (at: number) => `h:${new Date(at).toISOString().slice(0, 13)}`;
export const daySlot = (at: number) => `d:${new Date(at).toISOString().slice(0, 10)}`;
export function slotRange(slot: string): [number, number] {
  const day = slot.startsWith("d:"), start = Date.parse(day ? `${slot.slice(2)}T00:00:00Z` : `${slot.slice(2)}:00:00Z`);
  return [start, start + (day ? DAY : HOUR)];
}
const floorTo = (at: number, size: number) => Math.floor(at / size) * size;

let lastStamp = 0;
/** strictly increasing across this process; across processes it is the wall clock */
export const stamp = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));

/** lets the event loop run between chunks of work: never more than `budgetMs` of work without a break */
export function pacer(budgetMs = 15) {
  let since = performance.now();
  return async () => {
    if (performance.now() - since < budgetMs) return;
    await new Promise(resolve => setImmediate(resolve));
    since = performance.now();
  };
}

type Segment = { raw: [number, number] } | { slot: string };
/** a window as closed day and hour slots, with raw events only before the first whole hour and after the last closed one */
export function segmentsOf(since: number, until: number, now: number): Segment[] {
  const closed = floorTo(now, HOUR), out: Segment[] = [];
  let at = since;
  const firstHour = Math.min(until, Math.ceil(since / HOUR) * HOUR);
  if (at < firstHour) { out.push({ raw: [at, firstHour] }); at = firstHour; }
  while (at < until) {
    if (at % DAY === 0 && at + DAY <= until && at + DAY <= closed) { out.push({ slot: daySlot(at) }); at += DAY; continue; }
    if (at + HOUR <= until && at + HOUR <= closed) { out.push({ slot: hourSlot(at) }); at += HOUR; continue; }
    out.push({ raw: [at, until] }); break;
  }
  // neighbouring raw pieces read as one
  return out.reduce<Segment[]>((list, segment) => {
    const prev = list.at(-1);
    if (prev && "raw" in prev && "raw" in segment && prev.raw[1] === segment.raw[0]) prev.raw[1] = segment.raw[1]; else list.push(segment);
    return list;
  }, []);
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(item => b.includes(item));
const sourceOf = (scope: string) => scope.split("~")[0]!;

export interface RollupsOptions {
  store: RollupStore;
  digests: ReadonlyArray<Digest<unknown>>;
  now?: () => number;
  /** the most events one raw read returns; a chunk that reaches it is read again in halves */
  scanLimit?: number;
}

export function createRollups(options: RollupsOptions) {
  const { store, digests } = options, now = options.now ?? Date.now;
  const scanLimit = options.scanLimit ?? 400_000;
  const names = [...new Set(digests.flatMap(digest => digest.names))];
  const scopes = new Set<() => RollupScope | null>();
  const building = new Map<string, Promise<void>>();
  /** dirty marks this process made, ahead of the store */
  const local = new Map<string, number>();
  let pendingMarks = new Map<string, Set<string>>(), flushing: Promise<void> | null = null;
  const following = new WeakSet<AnalyticsSink>();
  /** events that land in a closed hour (an app's queued events) or are removed mark their hour stale */
  function follow(scope: RollupScope) {
    if (following.has(scope.sink) || !scope.sink.listen) return;
    following.add(scope.sink);
    const source = sourceOf(scope.key);
    scope.sink.listen(at => {
      const known = oldestKnown.get(scope.sink);
      if (known && (at === null || known.at === null || at < known.at)) oldestKnown.delete(scope.sink);
      if (at === null) touchAll(source); else if (at < floorTo(now(), HOUR)) touch(source, at);
    });
  }
  /** the oldest raw event, kept a while: the slots before it hold nothing and are neither read nor built */
  const oldestKnown = new WeakMap<AnalyticsSink, { at: number | null; until: number }>();
  async function oldestOf(sink: AnalyticsSink): Promise<number | null> {
    if (!sink.oldest) return 0;
    const known = oldestKnown.get(sink);
    if (known && known.until > Date.now()) return known.at;
    const at = await sink.oldest();
    oldestKnown.set(sink, { at, until: Date.now() + 10 * 60_000 });
    return at;
  }

  /** every event in [since, until), read in pieces small enough never to be cut short by the scan limit */
  async function scanAll(sink: AnalyticsSink, since: number, until: number, wanted: readonly string[]): Promise<StoredEvent[]> {
    const out: StoredEvent[] = [];
    for (let at = since; at < until; at = Math.min(until, floorTo(at, HOUR) + HOUR)) {
      const end = Math.min(until, floorTo(at, HOUR) + HOUR);
      out.push(...await scanPiece(sink, at, end, wanted));
    }
    return out;
  }
  async function scanPiece(sink: AnalyticsSink, since: number, until: number, wanted: readonly string[]): Promise<StoredEvent[]> {
    const events = await sink.scan(since, until, wanted, true);
    if (events.length < scanLimit || until - since < 2) return events;
    const mid = since + Math.floor((until - since) / 2);
    return [...await scanPiece(sink, since, mid, wanted), ...await scanPiece(sink, mid, until, wanted)];
  }

  async function fold<P>(digest: Digest<P>, events: readonly StoredEvent[], into: P = digest.empty()): Promise<P> {
    const pause = pacer();
    for (let i = 0; i < events.length; i++) {
      digest.add(into, events[i]!);
      if ((i & 1023) === 1023) await pause();
    }
    return into;
  }
  const kept = (scope: RollupScope, events: StoredEvent[]) => scope.drops ? events.filter(event => !scope.drops!(event)) : events;

  async function dirtyOf(source: string, slots: readonly string[]) {
    const marks = await store.marks(source, slots);
    for (const slot of [...slots, "*"]) {
      const mine = local.get(`${source}|${slot}`);
      if (mine !== undefined && mine > (marks.get(slot) ?? 0)) marks.set(slot, mine);
    }
    return marks;
  }
  function good(scope: RollupScope, doc: RollupMeta | undefined, version: number, marks: Map<string, number>) {
    if (!doc || doc.v !== version) return false;
    if (doc.builtAt <= Math.max(marks.get(doc.slot) ?? 0, marks.get("*") ?? 0)) return false;
    if (scope.hidden) {
      const here = (doc.accounts ?? []).filter(id => scope.hidden!.has(id)).sort();
      if (!sameSet(here, doc.hiddenHere ?? [])) return false;
    }
    return true;
  }

  /** builds one hour from raw events, or one day from its hours; every digest of the slot at once */
  function build(scope: RollupScope, slot: string): Promise<void> {
    const key = `${scope.key}|${slot}`;
    const running = building.get(key);
    if (running) return running;
    const work = (slot.startsWith("h:") ? buildHour(scope, slot) : buildDay(scope, slot))
      .catch(error => { console.error(`[analytics] rollup ${scope.key} ${slot} not built: ${(error as Error).message}`); })
      .finally(() => building.delete(key));
    building.set(key, work);
    return work;
  }
  async function encode(value: unknown): Promise<Uint8Array> {
    const data = await zip(Buffer.from(JSON.stringify(value)));
    if (data.length > MAX_DOC_BYTES) throw new Error(`a digest of ${data.length} bytes is too big to store`);
    return data;
  }
  async function decode(data: Uint8Array) { return JSON.parse((await unzip(data)).toString()); }

  async function buildHour(scope: RollupScope, slot: string) {
    const [start, end] = slotRange(slot);
    const builtAt = stamp();
    const raw = await scanAll(scope.sink, start, end, names);
    const accounts = scope.hidden ? [...new Set(raw.map(event => event.accountId).filter((id): id is string => !!id))].sort() : undefined;
    const events = kept(scope, raw);
    const docs: RollupDoc[] = [];
    for (const digest of digests) {
      const wanted = new Set(digest.names);
      const folded = await fold(digest, events.filter(event => wanted.has(event.name)));
      docs.push({ scope: scope.key, kind: digest.kind, slot, at: start, v: digest.version, builtAt, count: raw.length, ...(accounts ? { accounts, hiddenHere: accounts.filter(id => scope.hidden!.has(id)) } : {}),
        data: await encode(digest.encode(folded)) });
    }
    await store.write(docs);
  }
  async function buildDay(scope: RollupScope, slot: string) {
    const [start] = slotRange(slot);
    const hours = Array.from({ length: 24 }, (_, i) => hourSlot(start + i * HOUR));
    // stamped before its hours are read: a late event after this marks the day newer than the digest
    const builtAt = stamp();
    const docs: RollupDoc[] = [];
    for (const digest of digests) {
      const found = await slots(scope, digest, hours);
      // an hour that late events keep dirtying leaves the day unbuilt; its hours are read instead
      if (found.size < hours.length) return;
      const parts = hours.map(hour => found.get(hour)!);
      const pause = pacer();
      const merged = digest.empty();
      for (const part of parts) { digest.merge(merged, digest.decode(await decode(part.data))); await pause(); }
      const accounts = scope.hidden ? [...new Set(parts.flatMap(part => part.accounts ?? []))].sort() : undefined;
      docs.push({ scope: scope.key, kind: digest.kind, slot, at: start, v: digest.version, builtAt, count: parts.reduce((sum, part) => sum + part.count, 0),
        ...(accounts ? { accounts, hiddenHere: [...new Set(parts.flatMap(part => part.hiddenHere ?? []))].sort() } : {}), data: await encode(digest.encode(merged)) });
    }
    await store.write(docs);
  }

  /** the stored digests of these slots, building the missing or stale ones once; a slot still stale after that (late events
   *  keep landing in it) is left out, and the caller reads it raw */
  async function slots<P>(scope: RollupScope, digest: Digest<P>, wanted: readonly string[]): Promise<Map<string, RollupDoc>> {
    const source = sourceOf(scope.key);
    const look = async () => {
      const [docs, marks] = await Promise.all([store.read(scope.key, digest.kind, wanted), dirtyOf(source, wanted)]);
      return new Map(docs.filter(doc => good(scope, doc, digest.version, marks)).map(doc => [doc.slot, doc]));
    };
    const first = await look();
    const missing = wanted.filter(slot => !first.has(slot));
    if (!missing.length) return first;
    for (const slot of missing) await build(scope, slot);
    return look();
  }

  /** the digest of [since, until): stored slots for the closed hours and days inside it, raw events for the rest */
  async function read<P>(scope: RollupScope, digest: Digest<P>, since: number, until: number): Promise<P> {
    follow(scope);
    const oldest = await oldestOf(scope.sink);
    if (oldest === null) return digest.empty();
    const segments = segmentsOf(since, until, now()).filter(segment => ("raw" in segment ? segment.raw[1] : slotRange(segment.slot)[1]) > oldest);
    const wanted = segments.flatMap(segment => "slot" in segment ? [segment.slot] : []);
    const docs = wanted.length ? await slots(scope, digest, wanted) : new Map<string, RollupDoc>();
    const pieces: Array<RollupDoc | [number, number]> = [];
    for (const segment of segments) {
      if ("raw" in segment) { pieces.push(segment.raw); continue; }
      const doc = docs.get(segment.slot);
      if (doc) { pieces.push(doc); continue; }
      const [start, end] = slotRange(segment.slot);
      if (segment.slot.startsWith("h:")) { pieces.push([start, end]); continue; }
      // a day that could not be built: its hours, raw where an hour could not be either
      const hours = Array.from({ length: 24 }, (_, i) => hourSlot(start + i * HOUR)), found = await slots(scope, digest, hours);
      hours.forEach((hour, i) => pieces.push(found.get(hour) ?? [start + i * HOUR, start + (i + 1) * HOUR]));
    }
    const out = digest.empty();
    const pause = pacer();
    for (const piece of pieces) {
      digest.merge(out, Array.isArray(piece) ? await fold(digest, kept(scope, await scanAll(scope.sink, piece[0], piece[1], digest.names))) : digest.decode(await decode(piece.data)));
      await pause();
    }
    return out;
  }

  /** a late or removed event: the hour and day it fell in are rebuilt before they are read again */
  function touch(source: string, at: number) {
    const s = stamp();
    for (const slot of [hourSlot(at), daySlot(at)]) {
      local.set(`${source}|${slot}`, s);
      (pendingMarks.get(source) ?? pendingMarks.set(source, new Set()).get(source)!).add(slot);
    }
    flush();
  }
  function touchAll(source: string) {
    local.set(`${source}|*`, stamp());
    (pendingMarks.get(source) ?? pendingMarks.set(source, new Set()).get(source)!).add("*");
    flush();
  }
  function flush() {
    if (flushing) return;
    flushing = (async () => {
      while (pendingMarks.size) {
        const batch = pendingMarks;
        pendingMarks = new Map();
        for (const [source, slotSet] of batch) {
          const slotList = [...slotSet];
          const newest = Math.max(...slotList.map(slot => local.get(`${source}|${slot}`) ?? 0));
          await store.mark(source, slotList, newest).catch(() => { for (const slot of slotList) (pendingMarks.get(source) ?? pendingMarks.set(source, new Set()).get(source)!).add(slot); });
        }
        if (pendingMarks.size) await new Promise(resolve => setTimeout(resolve, 1000).unref?.());
      }
    })().finally(() => { flushing = null; });
  }

  function liveScopes() {
    const out = new Map<string, RollupScope>();
    for (const scopeOf of scopes) { const scope = scopeOf(); if (scope && !out.has(scope.key)) out.set(scope.key, scope); }
    return [...out.values()];
  }
  let sweep = 0;
  /** one pass: every closed day (and today's closed hours) built for each scope read so far, recent counts checked against
   *  the raw events (late events, removed accounts, expired days), older days a few at a time */
  async function backfill(options: { checkDays?: number; sweepDays?: number } = {}) {
    const time = now(), today = floorTo(time, DAY), closed = floorTo(time, HOUR);
    const checked = new Set<string>();
    for (const scope of liveScopes()) {
      follow(scope);
      const source = sourceOf(scope.key);
      const oldest = await oldestOf(scope.sink);
      if (oldest === null) continue;
      const first = Math.max(floorTo(oldest, DAY), today - RAW_RETENTION_DAYS * DAY);
      const days: string[] = [];
      for (let at = first; at < today; at += DAY) days.push(daySlot(at));
      const hours: string[] = [];
      for (let at = today; at < closed; at += HOUR) hours.push(hourSlot(at));
      if (scope.sink.count && !checked.has(source)) {
        checked.add(source);
        const recent = [...days.slice(-(options.checkDays ?? 8)), ...hours];
        const older = days.slice(0, -(options.checkDays ?? 8));
        const sweepCount = options.sweepDays ?? 8;
        const swept = older.length ? Array.from({ length: Math.min(sweepCount, older.length) }, (_, i) => older[(sweep + i) % older.length]!) : [];
        sweep += sweepCount;
        const metas = new Map((await store.meta(scope.key, [...recent, ...swept])).map(doc => [`${doc.slot}`, doc]));
        for (const slot of [...recent, ...swept]) {
          const doc = metas.get(slot);
          if (!doc) continue;
          const [start, end] = slotRange(slot);
          if (await scope.sink.count(start, end, names) !== doc.count) {
            if (slot.startsWith("d:")) { for (let at = start; at < end; at += HOUR) touch(source, at); } else touch(source, start);
          }
        }
      }
      const pause = pacer(50);
      for (const digest of digests) {
        const metas = await store.meta(scope.key, [...days, ...hours]);
        const marks = await dirtyOf(source, [...days, ...hours]);
        const byKey = new Map(metas.filter(doc => doc.kind === digest.kind).map(doc => [doc.slot, doc]));
        for (const slot of [...days, ...hours]) {
          if (good(scope, byKey.get(slot), digest.version, marks)) continue;
          await build(scope, slot);
          await pause();
        }
      }
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null, running: Promise<void> | null = null;
  function runOnce() {
    running ??= backfill().catch(error => { console.error(`[analytics] rollup pass failed: ${(error as Error).message}`); }).finally(() => { running = null; });
    return running;
  }
  return {
    read, touch, touchAll, backfill, segmentsOf,
    /** a scope the admin reads: the timer keeps its digests built */
    watch(scopeOf: () => RollupScope | null) { scopes.add(scopeOf); },
    /** builds missing digests now and then every `everyMs`; the first pass waits `delayMs` so startup is not slowed */
    start(everyMs = 10 * 60_000, delayMs = 30_000) {
      if (timer) return;
      const tick = () => { void runOnce().finally(() => { timer = setTimeout(tick, everyMs); timer.unref?.(); }); };
      timer = setTimeout(tick, delayMs); timer.unref?.();
    },
    stop() { if (timer) clearTimeout(timer); timer = null; },
    /** waits for dirty marks to reach the store */
    async settle() { while (flushing) await flushing; },
  };
}
export type Rollups = ReturnType<typeof createRollups>;

export function memoryRollupStore(): RollupStore & { docs: Map<string, RollupDoc> } {
  const docs = new Map<string, RollupDoc>(), marks = new Map<string, number>();
  return {
    docs,
    async read(scope, kind, slots) { return slots.map(slot => docs.get(`${scope}|${kind}|${slot}`)).filter((doc): doc is RollupDoc => !!doc).map(doc => ({ ...doc })); },
    async meta(scope, slots) {
      const wanted = new Set(slots);
      return [...docs.values()].filter(doc => doc.scope === scope && wanted.has(doc.slot)).map(({ data: _data, ...meta }) => meta);
    },
    async write(list) { for (const doc of list) docs.set(`${doc.scope}|${doc.kind}|${doc.slot}`, doc); },
    async marks(source, slots) {
      const out = new Map<string, number>();
      for (const slot of [...slots, "*"]) { const at = marks.get(`${source}|${slot}`); if (at !== undefined) out.set(slot, at); }
      return out;
    },
    async mark(source, slots, at) { for (const slot of slots) marks.set(`${source}|${slot}`, Math.max(marks.get(`${source}|${slot}`) ?? 0, at)); },
  };
}
