import { useEffect, useMemo, useRef, useState } from "react";
import { useWelcomeOnScreen } from "@/lib/onboarding";
import { useStore } from "@/state/store";
import { funnelAccount } from "./funnel-account";
import { useLateCloudOnScreen } from "./late-cloud";
import { NotesAskCard } from "./NotesAskCard";
import { notesAskDue } from "./notes-ask";

/** how long the screen must stay quiet before the ask, so a reply lands and is read first */
export const NOTES_ASK_BEAT_MS = 2_500;
const TICK_MS = 250;

/** the person is looking at the app and nothing else asks for them: the window is in front, no other sheet, menu or
 * dialog is open, and they are not halfway through writing something */
export function quietScreen(): boolean {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
  if (document.querySelector('[aria-modal="true"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return false;
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) return !active.value.trim();
  if (active instanceof HTMLElement && active.isContentEditable) return !active.textContent?.trim();
  return true;
}

/** Asks about session notes at a calm moment only: a beat after the app opens or a reply finishes, never while a bot
 * works, over another sheet, in a window in the background or while the person types. */
export function NotesAskHost() {
  const { state } = useStore();
  const welcome = useWelcomeOnScreen();
  const lateCloud = useLateCloudOnScreen();
  const account = useMemo(() => funnelAccount(), []);
  const [open, setOpen] = useState<"shown" | "closed" | null>(null);
  const [moment, setMoment] = useState(0);
  const working = state.bots.some((bot) => bot.busy) || state.groups.some((group) => group.working || Boolean(group.busyBotId));
  const calm = Boolean(account) && state.connected && state.config !== null && !welcome && !lateCloud && !working;
  const calmNow = useRef(calm);
  calmNow.current = calm;
  const openedAt = useRef(false);
  const wasWorking = useRef(working);

  useEffect(() => {
    const replyFinished = wasWorking.current && !working;
    wasWorking.current = working;
    if (!calm || open) return;
    if (openedAt.current && !replyFinished) return;
    openedAt.current = true;
    setMoment((n) => n + 1);
  }, [calm, working, open]);

  useEffect(() => {
    if (!moment || !calm || open) return;
    let quietFor = 0, live = true;
    const timer = window.setInterval(() => {
      quietFor = quietScreen() ? quietFor + TICK_MS : 0;
      if (quietFor < NOTES_ASK_BEAT_MS) return;
      window.clearInterval(timer);
      void (async () => {
        const known = await account!.state().catch(() => null);
        if (!live || !known?.signedIn || !(await notesAskDue())) return;
        if (live && calmNow.current && quietScreen()) setOpen((now) => now ?? "shown");
      })();
    }, TICK_MS);
    return () => { live = false; window.clearInterval(timer); };
  }, [moment, calm, open, account]);

  if (open !== "shown") return null;
  return <NotesAskCard onDone={() => setOpen("closed")} />;
}
