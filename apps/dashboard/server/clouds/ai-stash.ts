// AI sign-ins made in the app's first run for a Cloud that does not exist yet. They are held here until that Cloud's home
// answers, handed to it once over the signed home channel (home-client.ts), then deleted.
//
// Security invariants: only sealed values are stored (AES-256-GCM under the cloud seal key, never plain); a sealed value
// names its account and Cloud and is opened only for that pair; an entry lives at most AI_STASH_TTL_MS (Mongo's TTL index,
// and every read skips expired ones); it is deleted on delivery, on a Cloud that ended, and on the owner's cancel. Never log
// a value, a sealed value or a request body.
import type { Db } from "mongodb";
import { parseAiSignInList, type AiSignIn } from "../../../../shared/ai-signins.ts";
import type { createSealer } from "./seal.ts";

export const AI_STASH_TTL_MS = 24 * 60 * 60_000;

export type { AiSignIn };

export interface AiStashEntry { cloudId: string; accountId: string; sealed: string; expiresAt: number }
export interface AiStashStore {
  put(entry: AiStashEntry): Promise<void>;
  get(cloudId: string): Promise<AiStashEntry | null>;
  drop(cloudId: string): Promise<void>;
  /** the Clouds with an entry that has not expired */
  pending(): Promise<string[]>;
}

/** The sign-ins a request carries, or null for anything else. */
export const parseAiSignIns = (value: unknown): AiSignIn[] | null => parseAiSignInList(value);

export function memoryAiStashStore(now: () => number = Date.now): AiStashStore {
  const entries = new Map<string, AiStashEntry>();
  const live = (entry: AiStashEntry | undefined) => (entry && entry.expiresAt > now() ? entry : null);
  return {
    async put(entry) { entries.set(entry.cloudId, { ...entry }); },
    async get(cloudId) {
      const entry = live(entries.get(cloudId));
      if (!entry) entries.delete(cloudId);
      return entry ? { ...entry } : null;
    },
    async drop(cloudId) { entries.delete(cloudId); },
    async pending() {
      for (const [id, entry] of entries) if (!live(entry)) entries.delete(id);
      return [...entries.keys()];
    },
  };
}

interface StashDoc { _id: string; accountId: string; sealed: string; expiresAt: Date }

/** Mongo keeps the entries: its TTL index deletes them at `expiresAt` even if nothing here runs again. */
export function mongoAiStashStore(db: Db, now: () => number = Date.now): AiStashStore {
  const collection = db.collection<StashDoc>("cloud_ai_stash");
  let ready: Promise<unknown> | null = null;
  const indexed = () => (ready ??= collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((error: unknown) => { ready = null; throw error; }));
  return {
    async put(entry) {
      await indexed();
      await collection.replaceOne({ _id: entry.cloudId }, { accountId: entry.accountId, sealed: entry.sealed, expiresAt: new Date(entry.expiresAt) }, { upsert: true });
    },
    async get(cloudId) {
      const doc = await collection.findOne({ _id: cloudId, expiresAt: { $gt: new Date(now()) } });
      return doc ? { cloudId: doc._id, accountId: doc.accountId, sealed: doc.sealed, expiresAt: doc.expiresAt.getTime() } : null;
    },
    async drop(cloudId) { await collection.deleteOne({ _id: cloudId }); },
    async pending() {
      return (await collection.find({ expiresAt: { $gt: new Date(now()) } }, { projection: { _id: 1 } }).limit(500).toArray()).map(doc => doc._id);
    },
  };
}

export interface AiStash {
  /** holds `items` for the account's Cloud, replacing what was held for it; false where values can't be sealed */
  hold(accountId: string, cloudId: string, items: AiSignIn[]): Promise<boolean>;
  /** the held sign-ins, only when they were sealed for this account and Cloud */
  open(cloudId: string): Promise<{ accountId: string; items: AiSignIn[] } | null>;
  drop(cloudId: string): Promise<void>;
  pending(): Promise<string[]>;
}

export function createAiStash(options: { store: AiStashStore; sealer: ReturnType<typeof createSealer>; now?: () => number }): AiStash {
  const { store, sealer } = options, now = options.now ?? Date.now;
  return {
    async hold(accountId, cloudId, items) {
      const sealed = sealer.seal(JSON.stringify({ v: 1, accountId, cloudId, items }));
      // without a seal key the sealer passes values through; a sign-in is never stored that way
      if (sealed.startsWith("plain.")) return false;
      await store.put({ cloudId, accountId, sealed, expiresAt: now() + AI_STASH_TTL_MS });
      return true;
    },
    async open(cloudId) {
      const entry = await store.get(cloudId);
      if (!entry) return null;
      try {
        const value = JSON.parse(sealer.unseal(entry.sealed)) as { v?: unknown; accountId?: unknown; cloudId?: unknown; items?: unknown };
        const items = parseAiSignIns(value.items);
        if (value.v !== 1 || value.accountId !== entry.accountId || value.cloudId !== cloudId || !items) throw new Error();
        return { accountId: entry.accountId, items };
      } catch {
        await store.drop(cloudId);
        return null;
      }
    },
    drop: cloudId => store.drop(cloudId),
    pending: () => store.pending(),
  };
}
