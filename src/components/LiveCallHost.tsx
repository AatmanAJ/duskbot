import { useEffect } from "react";
import { useReportCallPresence } from "@/lib/call-presence";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { handleLiveCallKey, onLiveStreamConnected, onServerCall } from "@/lib/live-call-media";
import { useStoreSelector } from "@/state/store";

export function LiveCallHost() {
  const liveCall = useStoreSelector((s) => s.liveCall);
  const connected = useStoreSelector((s) => s.connected);
  useReportCallPresence();
  useEffect(() => onServerCall(liveCall), [liveCall]);
  useEffect(() => onLiveStreamConnected(connected), [connected]);
  useEffect(() => {
    const isMac = isMacPlatform();
    const onKey = (event: KeyboardEvent) => {
      if (handleLiveCallKey(event, isMac)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
