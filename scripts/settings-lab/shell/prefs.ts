import { createContext, useContext, useEffect, useState } from "react";

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
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: still works this visit */ }
  }, [key, value]);
  return [value, setValue] as const;
}

export type LabPrefs = { reduced: boolean; speed: number; dark: boolean };
export const LabContext = createContext<LabPrefs>({ reduced: false, speed: 1, dark: false });
/** the lab's reduced-motion switch (or the system's) and speed, for variants and the kit */
export const useLab = () => useContext(LabContext);
