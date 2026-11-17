import { useEffect } from "react";

import type { RoutineRun } from "@/lib/routines";
import { api, useDispatch, useStoreSelector } from "./store";
import { botById } from "./store-index";

/** Loads the runs scheduled from `start` up to where the app's window begins, once a view shows dates before it. */
export function useRoutineRunsFrom(start: number): void {
  const dispatch = useDispatch();
  const since = useStoreSelector((state) => state.routineRunsSince);
  useEffect(() => {
    if (since === null || start >= since) return;
    let live = true;
    api(`/api/routines?from=${start}&to=${since}`)
      .then(({ runs }) => { if (live && Array.isArray(runs)) dispatch({ type: "routineRunsLoaded", runs, from: start, to: since }); })
      .catch(() => {});
    return () => { live = false; };
  }, [start, since, dispatch]);
}

/** The run that worked in this conversation; one older than the app's window is loaded when the thread is a run's. */
export function useThreadRoutineRun(botId: string, threadId: string): RoutineRun | undefined {
  const dispatch = useDispatch();
  const run = useStoreSelector((state) => state.routineRuns.find((candidate) => candidate.target === "bot" && candidate.botId === botId && candidate.threadId === threadId));
  const marked = useStoreSelector((state) => Boolean(botById(state, botId)?.tasks?.some((task) => task.threadId === threadId && task.routineRunId)));
  const loadedSince = useStoreSelector((state) => state.routineRunsSince !== null);
  const missing = !run && marked && loadedSince;
  useEffect(() => {
    if (!missing) return;
    let live = true;
    api(`/api/routines?thread=${encodeURIComponent(threadId)}`)
      .then(({ runs }) => { if (live && Array.isArray(runs) && runs.length) dispatch({ type: "routineRunsLoaded", runs }); })
      .catch(() => {});
    return () => { live = false; };
  }, [missing, threadId, dispatch]);
  return run;
}
