import { useEffect, useRef } from "react";
import { useLanguageChoice } from "@/lib/language-preference";
import { duePing, openTarget, presenceBody, shownLanguage } from "@/lib/presence-client";
import { existingThreadTarget } from "@/lib/thread-target";
import { openThread } from "@/state/thread-navigation";
import { api, type Action, type AppState } from "@/state/store";

const ACTIVITY = ["focus", "pointerdown", "keydown"] as const;

function selection(state: AppState): string {
  const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
  const threadId = bot ? bot.switchingTo ?? bot.threadId : state.groups.find((group) => group.id === state.selectedId)?.threadId;
  return `${state.selectedId}\n${threadId ?? ""}`;
}

/** The bot conversation open in front of the person, if one is. */
function openChat(state: AppState): string | undefined {
  const bot = state.bots.find((candidate) => candidate.id === state.selectedId);
  return bot ? bot.switchingTo ?? bot.threadId : undefined;
}

/** Tells the server the person is here and which chat they have open, and opens the chat the answer names: the brief the
 * Chief posted for this arrival. */
/** `read` gives the newest state; pings start once `hydrated`. */
export function usePresence(hydrated: boolean, configLanguage: string | undefined, read: () => AppState, dispatch: (action: Action) => void): void {
  const lastPing = useRef<number | null>(null);
  const language = shownLanguage(configLanguage, useLanguageChoice());
  const latest = useRef({ read, dispatch, language });
  latest.current = { read, dispatch, language };
  const sentLanguage = useRef(language);
  const pingNow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!hydrated) return;
    const ping = (force = false) => {
      const now = Date.now();
      if (!force && !duePing(lastPing.current, now)) return;
      lastPing.current = now;
      const sentFrom = selection(latest.current.read());
      sentLanguage.current = latest.current.language;
      const body = presenceBody(Intl.DateTimeFormat().resolvedOptions().timeZone, sentLanguage.current, openChat(latest.current.read()));
      void api("/api/presence/active", { method: "POST", body: JSON.stringify(body) }).then((answer) => {
        const live = latest.current, state = live.read();
        const target = existingThreadTarget(openTarget(answer), state);
        if (target && selection(state) === sentFrom) openThread(live.dispatch, target, state);
      }, () => {});
    };
    const onActivity = () => ping();
    const onVisible = () => { if (document.visibilityState === "visible") ping(); };
    pingNow.current = () => ping(true);
    onVisible();
    for (const name of ACTIVITY) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      pingNow.current = () => {};
      for (const name of ACTIVITY) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [hydrated]);
  useEffect(() => {
    if (language !== sentLanguage.current) pingNow.current();
  }, [language]);
}
