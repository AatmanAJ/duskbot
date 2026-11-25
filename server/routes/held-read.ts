import type { ServerResponse } from "node:http";

import type { Store } from "../store.ts";

const RECHECK_MS = 2_000;
const SETTLE_MS = 150;

export interface HeldReadOptions<T extends { version: string }> {
  res: ServerResponse;
  store: Pick<Store, "onChange">;
  known: string;
  wait: number;
  read(): T | null;
  recheckMs?: number;
}

export function holdUntilChanged<T extends { version: string }>(options: HeldReadOptions<T>): Promise<{ view: T | null } | { error: unknown }> {
  const { res, store, known, wait, read } = options;
  return new Promise((answer) => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (next: { view: T | null } | { error: unknown }) => {
      if (done) return;
      done = true;
      clearTimeout(settleTimer);
      clearTimeout(deadline);
      clearInterval(recheck);
      unsubscribe();
      res.off("close", abandoned);
      answer(next);
    };
    const look = (always: boolean) => {
      if (done) return;
      let next: T | null;
      try { next = read(); } catch (error) { return finish({ error }); }
      if (always || !next || next.version !== known) finish({ view: next });
    };
    const abandoned = () => finish({ view: null });
    const unsubscribe = store.onChange(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => look(false), SETTLE_MS);
    });
    const recheck = setInterval(() => look(false), options.recheckMs ?? RECHECK_MS);
    const deadline = setTimeout(() => look(true), wait);
    res.on("close", abandoned);
  });
}

export function wholeParam(params: URLSearchParams, name: string, max: number): number | null {
  const raw = params.get(name);
  if (raw === null || raw === "") return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
}
