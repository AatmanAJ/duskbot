import type { MobilePlatform } from "../platform";
import { BACKGROUND_HEADERS } from "@/lib/cloud-power";

/** under the host's 60 s lease, so a phone with the app open never counts as away between two of these */
export const PRESENCE_BEAT_MS = 25_000;

function say(away: boolean, threadId: string | null) {
  void fetch("/api/mobile/presence", { method: "PUT", headers: { "Content-Type": "application/json", ...BACKGROUND_HEADERS }, body: JSON.stringify({ away, threadId }), keepalive: true, signal: AbortSignal.timeout(10_000) })
    .then((response) => response.body?.cancel())
    .catch(() => {});
}

let viewing: string | null = null;
let viewingChanged: (() => void) | null = null;

/** The conversation on screen, null for none; the workspace never pushes it to this phone while the app is open. */
export function setPresenceThread(threadId: string | null): void {
  if (viewing === threadId) return;
  viewing = threadId;
  viewingChanged?.();
}

/** Tells the workspace whether the app is open, and on which conversation, so it pushes only what the person is not
 * already looking at. Returns the stop. */
export function reportPresence(platform: Pick<MobilePlatform, "onPause" | "onResume">, doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> = document): () => void {
  let beat: ReturnType<typeof setInterval> | undefined;
  let here: boolean | undefined;
  const set = (open: boolean) => {
    if (here === open) return;
    here = open;
    clearInterval(beat);
    beat = open ? setInterval(() => say(false, viewing), PRESENCE_BEAT_MS) : undefined;
    say(!open, open ? viewing : null);
  };
  set(doc.visibilityState !== "hidden");
  const visibility = () => set(doc.visibilityState !== "hidden");
  const stops = [platform.onPause?.(() => set(false)), platform.onResume?.(() => set(true))];
  doc.addEventListener("visibilitychange", visibility);
  const changed = () => { if (here) say(false, viewing); };
  viewingChanged = changed;
  return () => {
    clearInterval(beat);
    if (viewingChanged === changed) viewingChanged = null;
    doc.removeEventListener("visibilitychange", visibility);
    for (const stop of stops) stop?.();
  };
}
