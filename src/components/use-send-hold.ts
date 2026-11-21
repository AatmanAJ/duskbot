import { useCallback, useEffect, useRef, useState } from "react";

/** A send the server never answers lets go of the grayed Send after this long. */
export const SEND_HOLD_MAX_MS = 15_000;
const SEND_TURN_WAIT_MS = 1_500;

/** A sent message keeps Send, grayed (on the phone in its own fill), until the server has it; then the arrow crossfades to the mic (or Stop). With
 * `untilTurn` (the phone) a send that settles before the turn shows as busy keeps its button until it does, or briefly
 * when no turn follows, so the round button goes from Send straight to Stop. `scope` changing (another chat) lets go. */
export function useSendHold(busy: boolean, untilTurn: boolean, scope: string) {
  const [sendHeld, setSendHeld] = useState<string | null>(null);
  const [heldForTurn, setHeldForTurn] = useState<string | null>(null);
  const live = useRef({ busy, untilTurn });
  live.current = { busy, untilTurn };
  useEffect(() => {
    if (!sendHeld) return;
    const timer = setTimeout(() => setSendHeld((held) => (held === sendHeld ? null : held)), SEND_HOLD_MAX_MS);
    return () => clearTimeout(timer);
  }, [sendHeld]);
  useEffect(() => { setSendHeld(null); setHeldForTurn(null); }, [scope]);
  useEffect(() => {
    if (!heldForTurn) return;
    const release = () => { setHeldForTurn(null); setSendHeld((held) => (held === heldForTurn ? null : held)); };
    if (busy) { release(); return; }
    const timer = setTimeout(release, SEND_TURN_WAIT_MS);
    return () => clearTimeout(timer);
  }, [busy, heldForTurn]);
  /** Holds Send for this send; the returned function is its settle callback. */
  const holdSend = useCallback((sendId: string) => {
    setSendHeld(sendId);
    return () => {
      if (live.current.untilTurn && !live.current.busy) { setHeldForTurn(sendId); return; }
      setSendHeld((held) => (held === sendId ? null : held));
    };
  }, []);
  return { sendHeld, holdSend };
}
