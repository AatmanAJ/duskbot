import { useEffect } from "react";
import { CLOUD_WELCOME_DONE } from "@/lib/cloud-setup";
import { forgetWelcomeDoneHere, saveWelcomeHints, useCloudWelcome } from "@/lib/cloud-welcome";
import { hintSeen, type WelcomeViewer } from "@/lib/onboarding";
import { useDispatch, useStoreSelector } from "@/state/store";

/** Outlives the welcome: an end of it that this device kept, because the Cloud could not save it then, reaches the Cloud's record. */
export function WelcomeKeeper({ viewer }: { viewer: WelcomeViewer | null }) {
  const dispatch = useDispatch();
  const welcome = useCloudWelcome();
  const saved = useStoreSelector((s) => s.config?.onboarding);
  const connected = useStoreSelector((s) => s.connected);
  const resend = Boolean(welcome.doneHere && viewer?.cloudHome && viewer.canSave && connected && saved);
  useEffect(() => {
    if (!resend || !saved) return;
    if (hintSeen(saved, CLOUD_WELCOME_DONE)) forgetWelcomeDoneHere();
    else void saveWelcomeHints(saved, [CLOUD_WELCOME_DONE], dispatch).then((done) => { if (done) forgetWelcomeDoneHere(); });
  }, [resend, saved, dispatch]);
  return null;
}
