import { useSyncExternalStore } from "react";

export type ComputerWakeKind = "provision" | "vm-start";

/** A bot's computer waking. It belongs to the bot, not to the view that asked: the tab can change, or the panel close,
 * and the wake goes on; a view that comes back shows it where it is. */
export interface ComputerWake {
  kind: ComputerWakeKind;
  /** the live picture asked for beside the wake */
  viewer: string;
  promise: Promise<unknown>;
  settled: null | { ok: true; value: unknown } | { ok: false; error: unknown };
}

const SETTLED_KEPT_MS = 30_000;
const wakes = new Map<string, ComputerWake>();
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };

/** Starts waking `key`'s computer, or joins the wake already on its way. */
export function startComputerWake<T>(key: string, kind: ComputerWakeKind, viewer: string, work: () => Promise<T>): Promise<T> {
  const running = wakes.get(key);
  if (running && !running.settled) return running.promise as Promise<T>;
  const settle = (settled: NonNullable<ComputerWake["settled"]>) => {
    const current = wakes.get(key);
    if (current?.promise !== promise) return;
    const done = { ...current, settled };
    wakes.set(key, done);
    publish();
    setTimeout(() => { if (wakes.get(key) === done) { wakes.delete(key); publish(); } }, SETTLED_KEPT_MS);
  };
  const promise: Promise<T> = Promise.resolve().then(work).then(
    (value) => { settle({ ok: true, value }); return value; },
    (error: unknown) => { settle({ ok: false, error }); throw error; },
  );
  wakes.set(key, { kind, viewer, promise, settled: null });
  publish();
  return promise;
}

export function computerWake(key: string): ComputerWake | null {
  return wakes.get(key) ?? null;
}

export function forgetComputerWakes(): void {
  wakes.clear();
  publish();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useComputerWake(key: string): ComputerWake | null {
  return useSyncExternalStore(subscribe, () => computerWake(key), () => null);
}
