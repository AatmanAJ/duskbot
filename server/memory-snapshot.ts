// About me and the bot's core notes are read once per conversation session and then held, so the cached prompt prefix
// stays byte-identical while a chat is active. A fact saved meanwhile reaches the chat as a one-time note in the turn's
// message; the held copy is refreshed once the chat has been idle longer than a provider keeps its prompt cache, and at
// once when a line was removed or replaced.
export const SNAPSHOT_IDLE_MS = 30 * 60_000;
const DELTA_MAX_CHARS = 1_500;

/** The raw texts a conversation's memory prompt is built from. */
export interface MemoryTexts {
  /** About me as the person and their bots wrote it. */
  about: string;
  /** MEMORY.md, whole. */
  notes: string;
  /** The topic index. */
  topics: string;
}

interface Held extends MemoryTexts {
  /** What else decides the text (memory on or off, writes refused): a change starts a fresh copy. */
  shape: string;
  usedAt: number;
  announced: Set<string>;
  pending: string[];
}

const held = new Map<string, Held>();

const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter((line) => line.length > 2 && !/^#|^---$/.test(line));

function delta(from: MemoryTexts, to: MemoryTexts): { added: string[]; removed: string[] } {
  const before = new Set([...lines(from.about), ...lines(from.notes)]);
  const after = new Set([...lines(to.about), ...lines(to.notes)]);
  return { added: [...after].filter((line) => !before.has(line)), removed: [...before].filter((line) => !after.has(line)) };
}

/** The texts this turn's system prompt uses for `key` (a bot in one conversation). */
export function heldMemory(key: string, shape: string, current: () => MemoryTexts, now = Date.now()): MemoryTexts {
  const known = held.get(key);
  if (!known || known.shape !== shape || now - known.usedAt > SNAPSHOT_IDLE_MS) {
    const fresh = current();
    held.set(key, { ...fresh, shape, usedAt: now, announced: new Set(), pending: [] });
    return fresh;
  }
  const latest = current();
  const change = delta(known, latest);
  // a removed, forgotten or replaced line must stop reaching the model now, whatever that costs the cache
  if (change.removed.length) {
    held.set(key, { ...latest, shape, usedAt: now, announced: new Set(), pending: [] });
    return latest;
  }
  known.usedAt = now;
  const notes = change.added.map((line) => `+ ${line}`).filter((line) => !known.announced.has(line));
  for (const note of notes) known.announced.add(note);
  known.pending.push(...notes);
  return { about: known.about, notes: known.notes, topics: known.topics };
}

/** Changes to memory since this conversation's copy was taken, each said once; empty when nothing changed. */
export function takeMemoryDelta(key: string): string {
  const known = held.get(key);
  if (!known?.pending.length) return "";
  const notes: string[] = [];
  let size = 0;
  for (const note of known.pending) {
    if (size + note.length > DELTA_MAX_CHARS) break;
    notes.push(note.length > 300 ? `${note.slice(0, 300)}…` : note);
    size += note.length + 1;
  }
  known.pending = [];
  return `Saved to your memory since this conversation started (your instructions show the older list):\n${notes.join("\n")}`;
}

/** A summarized conversation starts its next turn from memory as it is now, the way a fresh session would. */
export function releaseHeldMemory(key: string): void {
  held.delete(key);
}
