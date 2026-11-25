import { useEffect, useRef } from "react";
import type { TeachStatus } from "../../shared/teach-task";
import { api, type Action } from "@/state/store";
import { withBrowserScope } from "./team-browser";

export type TeachAction = "start" | "stop" | "discard";

const path = (botId: string, scope: Readonly<Record<string, string>>) => withBrowserScope(`/api/bots/${encodeURIComponent(botId)}/browser/teach`, scope);

export function readTeach(botId: string, scope: Readonly<Record<string, string>>): Promise<TeachStatus> {
  return api(path(botId, scope));
}

export function sendTeach(botId: string, scope: Readonly<Record<string, string>>, action: TeachAction): Promise<TeachStatus> {
  return api(path(botId, scope), { method: "POST", body: JSON.stringify({ action }) });
}

/** A request to teach a bot a task from outside its browser panel (the palette, its skills); dropped once stale. */
interface TeachRequest { botId: string; at: number }
const FRESH_MS = 10_000;
let pending: TeachRequest | null = null;
const takers = new Set<() => void>();

export function requestTeach(botId: string, now = Date.now()): void {
  pending = { botId, at: now };
  for (const take of takers) take();
}

/** Opens the bot's browser in the side panel and starts recording there. */
export function startTeaching(dispatch: (action: Action) => void, botId: string): void {
  requestTeach(botId);
  dispatch({ type: "toggleComputer", open: true });
}

/** Hands `start` each request for this bot, once; `peek` sees it without taking it, for the panel that shows the browser. */
export function useTeachRequest(botId: string, start: () => void, { peek = false } = {}): void {
  const latest = useRef(start);
  latest.current = start;
  useEffect(() => {
    const take = () => {
      const request = pending;
      if (!request || request.botId !== botId) return;
      if (!peek) pending = null;
      if (Date.now() - request.at <= FRESH_MS) latest.current();
    };
    take();
    takers.add(take);
    return () => { takers.delete(take); };
  }, [botId, peek]);
}

export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
