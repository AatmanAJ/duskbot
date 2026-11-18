import { useEffect, useSyncExternalStore } from "react";

type Availability = boolean | null;

let current: Availability = null;
let asking: Promise<void> | null = null;
const watchers = new Set<() => void>();

function pageCanCall(): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.mediaDevices?.getUserMedia === "function"
    && typeof globalThis.AudioContext === "function";
}

function ask(): void {
  if (current !== null || asking) return;
  if (!pageCanCall()) {
    current = false;
    return;
  }
  asking = fetch("/api/voice/local")
    .then((res) => (res.ok ? res.json() : { available: false }))
    .then((body: { available?: boolean }) => { current = body.available === true; })
    .catch(() => { current = false; })
    .finally(() => {
      asking = null;
      for (const fn of Array.from(watchers)) fn();
    });
}

/** Whether a voice call with the built-in voice can run here: null until the server has answered. */
export function useLocalVoiceCall(): Availability {
  useEffect(ask, []);
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => current,
    () => current,
  );
}

export function localVoiceCallKnown(): Availability {
  return current;
}
