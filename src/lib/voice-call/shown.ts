// How much of a streaming reply the chat has put on screen, per thread, so a call never says words before they show.
// Written by the streaming bubble; nothing written means nothing is streaming there, and nothing holds the voice back.

const shown = new Map<string, number>();
const watchers = new Set<() => void>();

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function noteShownWords(threadId: string, words: number | null): void {
  if (words === null) shown.delete(threadId);
  else shown.set(threadId, words);
  for (const fn of Array.from(watchers)) fn();
}

export function shownWords(threadId: string): number | null {
  return shown.get(threadId) ?? null;
}

/** Resolves once `words` of the thread's reply are on screen, the reply stops streaming, or `capMs` passes. */
export function untilShown(threadId: string, words: number, capMs = 3_000): Promise<void> {
  const enough = () => {
    const now = shownWords(threadId);
    return now === null || now >= words;
  };
  if (enough()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      watchers.delete(check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (enough()) done();
    };
    const timer = setTimeout(done, capMs);
    watchers.add(check);
  });
}
