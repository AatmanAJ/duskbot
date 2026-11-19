import type { AppState } from "@/state/store";
import { threadsNeedingPages } from "@/state/use-selected-transcript";

const OPEN_CHAT_KEY = "dusk.mobile.openChat";

/** The chat open when the page last unloaded: iOS reclaiming a backgrounded web view reloads the page, sessionStorage stays. */
export function readOpenChat(): string | null {
  try { return sessionStorage.getItem(OPEN_CHAT_KEY); } catch { return null; }
}

export function rememberOpenChat(id: string | null): void {
  try { if (id) sessionStorage.setItem(OPEN_CHAT_KEY, id); else sessionStorage.removeItem(OPEN_CHAT_KEY); } catch { /* storage off */ }
}

/** "wait" until the snapshot has landed; then the chat to open again, or null when it is gone from this workspace. */
export function restoredChat(id: string, state: Pick<AppState, "hydrated" | "bots" | "groups">): string | null | "wait" {
  if (!state.hydrated) return "wait";
  return state.bots.some((bot) => bot.id === id) || state.groups.some((group) => group.id === id) ? id : null;
}

/** A snapshot read aborts the transcript reads under way, so with any still loading the stream-down reread waits: on a
 * slow route a read every few seconds would abort them every time and leave the open chat empty. */
export function rereadDue(state: Pick<AppState, "bots" | "groups">, hidden: boolean): boolean {
  return !hidden && threadsNeedingPages(state).length === 0;
}
