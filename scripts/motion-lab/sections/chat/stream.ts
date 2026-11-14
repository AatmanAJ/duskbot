import { useEffect, useRef, useState } from "react";

export const REPLY =
  "Found three that fit. The cheapest is IndiGo on Saturday at 6:10, ₹4,280 return, back Monday night. Air India leaves at a kinder 9:40 for ₹5,150. Akasa has a Friday-evening one at ₹4,900 if you can leave work early. Want me to hold the IndiGo seats while you decide?";

/** an engine's chunks as they really land: bursts of a few tokens, small gaps, and the odd stall */
export function burstyChunks(text: string, seed = 7): Array<{ at: number; text: string }> {
  let state = seed;
  const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const out: Array<{ at: number; text: string }> = [];
  let at = 0, i = 0;
  while (i < text.length) {
    const size = rand() < 0.15 ? 12 + Math.floor(rand() * 20) : 1 + Math.floor(rand() * 6);
    out.push({ at, text: text.slice(i, i + size) });
    i += size;
    at += rand() < 0.08 ? 420 + rand() * 300 : 30 + rand() * 130;
  }
  return out;
}

/** plays the chunks in at the lab's speed; `stop()` freezes what landed */
export function useFakeStream(text: string, running: boolean, runKey: number, speed: number) {
  const [received, setReceived] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setReceived("");
    setDone(false);
    if (!running) return;
    const chunks = burstyChunks(text);
    const timers = chunks.map((chunk, index) =>
      setTimeout(() => {
        setReceived((value) => value + chunk.text);
        if (index === chunks.length - 1) setDone(true);
      }, chunk.at / speed),
    );
    return () => timers.forEach(clearTimeout);
  }, [text, running, runKey, speed]);
  return { received, done };
}

/** Bursty text drained at a steady rate: whatever is behind empties over about `drainMs`, never slower than
 * `maxCharMs` per character, so the shown text never lags the real arrival by much. Reimplemented from the
 * behaviour of assistant-ui's useSmooth (MIT); no code copied. */
export function useSmoothText(target: string, { drainMs = 250, maxCharMs = 5, speed = 1, enabled = true } = {}) {
  const [shown, setShown] = useState(enabled ? "" : target);
  const shownRef = useRef(shown);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (!enabled) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    if (!target.startsWith(shownRef.current)) {
      shownRef.current = "";
      setShown("");
    }
    let frame = 0, last = performance.now(), carry = 0;
    const step = (now: number) => {
      const goal = targetRef.current;
      const behind = goal.length - shownRef.current.length;
      if (behind <= 0) return;
      const perChar = Math.min(maxCharMs, drainMs / behind) / speed;
      carry += now - last;
      last = now;
      const count = Math.floor(carry / perChar);
      if (count > 0) {
        carry -= count * perChar;
        shownRef.current = goal.slice(0, shownRef.current.length + count);
        setShown(shownRef.current);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, drainMs, maxCharMs, speed, enabled]);
  return shown;
}

/** text split into words that keep their trailing space, so a word renders once and never re-keys */
export function words(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}
