import { useCallback, useEffect, useState } from "react";

export type Pick = "original" | "a" | "b";
export type PickEntry = { pick?: Pick; note?: string; at?: string };
export type Picks = Record<string, PickEntry>;

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

/** a value kept in localStorage */
export function useStored<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage full or blocked: the lab still works for this visit
    }
  }, [key, value]);
  return [value, setValue] as const;
}

export const PICKS_KEY = "motion-lab-picks-v1";

export function usePicks() {
  const [picks, setPicks] = useStored<Picks>(PICKS_KEY, {});
  const update = useCallback(
    (key: string, patch: PickEntry) =>
      setPicks((all) => ({ ...all, [key]: { ...all[key], ...patch, at: new Date().toISOString() } })),
    [setPicks],
  );
  return [picks, update] as const;
}

export const itemKey = (sectionId: string, itemId: string) => `${sectionId}/${itemId}`;
