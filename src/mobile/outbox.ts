import { useContext, useEffect, useMemo } from "react";
import { useStore } from "@/state/store";
import { installSendOutbox } from "@/state/send-outbox";
import { createOutbox } from "@/state/outbox-queue";
import { ActiveConnection, outboxKey } from "./connection/active";
import { usePlatform } from "./platform";

export { createOutbox, OUTBOX_MAX_AGE_MS, OUTBOX_MAX_TRIES, replayAction } from "@/state/outbox-queue";

/** Keeps the open workspace's outbox installed under the store and sends what it holds whenever the live stream is
 * back: at start, after a lost connection, and on resume. */
export function useOutbox() {
  const platform = usePlatform();
  const connection = useContext(ActiveConnection);
  const { state, dispatch } = useStore();
  const outbox = useMemo(() => (connection ? createOutbox(platform.prefs, outboxKey(connection)) : null), [platform, connection]);
  useEffect(() => (outbox ? installSendOutbox(outbox) : undefined), [outbox]);
  const ready = Boolean(outbox && state.hydrated && state.connected);
  useEffect(() => { if (ready) void outbox!.flush(dispatch); }, [ready, outbox, dispatch]);
  useEffect(() => platform.onResume?.(() => { if (outbox && state.hydrated && state.connected) void outbox.flush(dispatch); }), [platform, outbox, state.hydrated, state.connected, dispatch]);
}
