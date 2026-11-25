import { useEffect, useMemo, useRef, useState } from "react";
import { useWelcomeOnScreen } from "@/lib/onboarding";
import { useStore } from "@/state/store";
import { funnelAccount } from "./funnel-account";
import { useLateCloudOnScreen } from "./late-cloud";
import { NotesAskCard } from "./NotesAskCard";
import { notesAskDue } from "./notes-ask";

/** Asks about session notes at a calm moment only: on app open and after a reply finishes, never while a bot works. */
export function NotesAskHost() {
  const { state } = useStore();
  const welcome = useWelcomeOnScreen();
  const lateCloud = useLateCloudOnScreen();
  const account = useMemo(() => funnelAccount(), []);
  const [open, setOpen] = useState<"shown" | "closed" | null>(null);
  const working = state.bots.some((bot) => bot.busy) || state.groups.some((group) => group.working || Boolean(group.busyBotId));
  const calm = Boolean(account) && state.connected && state.config !== null && !welcome && !lateCloud && !working;
  const calmNow = useRef(calm);
  calmNow.current = calm;
  const checkedAtOpen = useRef(false);
  const wasWorking = useRef(working);

  useEffect(() => {
    const replyFinished = wasWorking.current && !working;
    wasWorking.current = working;
    if (!calm || open) return;
    if (checkedAtOpen.current && !replyFinished) return;
    checkedAtOpen.current = true;
    void (async () => {
      const known = await account!.state().catch(() => null);
      if (!known?.signedIn || !(await notesAskDue())) return;
      if (calmNow.current) setOpen((now) => now ?? "shown");
    })();
  }, [calm, working, open, account]);

  if (open !== "shown") return null;
  return <NotesAskCard onDone={() => setOpen("closed")} />;
}
