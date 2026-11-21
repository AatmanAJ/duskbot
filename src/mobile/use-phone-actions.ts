import { useCallback, useEffect, useRef } from "react";

import type { Action, AppState } from "@/state/store";
import type { MobileOpenTarget } from "../../shared/mobile-link";
import { phoneActionFrom, type PhoneAction } from "./phone-actions";
import type { MobilePlatform } from "./platform";

/** Approve, Deny, Reply and Answer from a notification or a Live Activity: the app opens on the exact chat and does what
 * was pressed once the workspace is connected. */
export function usePhoneActions(platform: MobilePlatform, state: AppState, dispatch: (action: Action) => void, openTarget: (target: MobileOpenTarget) => void) {
  const queue = useRef<PhoneAction[]>([]);
  const ready = state.hydrated && state.connected;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const run = useCallback((action: PhoneAction) => {
    openTarget(action.target);
    const threadId = action.target.threadId!;
    if (action.kind === "decide") dispatch({ type: "decideRequest", threadId, requestId: action.requestId, behavior: action.behavior });
    else if (action.kind === "reply" && action.target.botId) dispatch({ type: "send", botId: action.target.botId, text: action.text, threadId });
  }, [dispatch, openTarget]);

  useEffect(() => platform.onPhoneAction?.((raw) => {
    const action = phoneActionFrom(raw);
    if (!action) return;
    if (readyRef.current) run(action);
    else queue.current.push(action);
  }), [platform, run]);

  useEffect(() => {
    if (!ready) return;
    for (const action of queue.current.splice(0)) run(action);
  }, [ready, run]);
}
