import { useEffect, useRef } from "react";

/** on every replay, run a short scripted sequence of steps (ms from start, scaled by speed); a click by hand still works */
export function useDemo(replayKey: number, speed: number, steps: Array<[number, () => void]>, reset?: () => void) {
  const latest = useRef(steps);
  latest.current = steps;
  useEffect(() => {
    reset?.();
    const timers = latest.current.map(([t], i) => setTimeout(() => latest.current[i]![1](), t / speed));
    return () => timers.forEach(clearTimeout);
  }, [replayKey]);
}
