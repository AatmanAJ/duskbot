import { useEffect, useState } from "react";
import { openChatLink } from "@/components/ThreadRefs";
import { openThread, type Action, type AppState, type ThreadTarget } from "@/state/store";

/** `read` gives the newest state; a link waits for `hydrated`. */
export function useExternalChatLinks(hydrated: boolean, read: () => AppState, dispatch: (action: Action) => void): void {
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => window.duskDesktop?.onChatLink?.(setLink), []);
  useEffect(() => {
    if (!link || !hydrated) return;
    setLink(null);
    const state = read();
    if (state.appSettingsOpen) dispatch({ type: "toggleAppSettings", open: false });
    if (state.shortcutsOpen) dispatch({ type: "toggleShortcuts", open: false });
    openChatLink(dispatch, link, state);
  }, [link, hydrated, read, dispatch]);
}

/** A click on a notification main showed brought this page up, maybe a page just loaded for it. */
export function useDesktopNotificationOpens(hydrated: boolean, read: () => AppState, dispatch: (action: Action) => void): void {
  const [target, setTarget] = useState<ThreadTarget | null>(null);
  useEffect(() => window.duskDesktop?.desktopNotifications?.onOpen(setTarget), []);
  useEffect(() => {
    if (!target || !hydrated) return;
    setTarget(null);
    openThread(dispatch, target, read());
  }, [target, hydrated, read, dispatch]);
}
