import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { setEmailGateDone, track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { chiefFor, chiefStepFits, createChiefPatch, myDefaultBot, stageIntro, useViewerEmail } from "@/lib/default-bot";
import { completionPatch, computerAiIds, firstRunPatch, markWelcomeFinished, resumeBeat, showWelcome, type BeatId } from "@/lib/onboarding";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import { looksLikeNotes } from "@/lib/assistant-notes";
import { greetingName } from "../../../shared/greeting-name";
import { api, useStore } from "@/state/store";
import { useNotesIntake } from "../NotesWaiting";
import { WindowDragStrip } from "../DesktopCapabilities";
import { AccountStep } from "./AccountStep";
import { AiStep } from "./AiStep";
import { BringStatus } from "./BringStep";
import { CloudBringStep, useCloudBringOffered } from "./CloudBringStep";
import { funnelSteps, nextStep, previousStep, type FunnelStep } from "./funnel";
import { funnelAccount, type FunnelAccountState } from "./funnel-account";
import { FunnelBar, WelcomeStep } from "./FunnelSteps";
import { useWelcomeAi } from "./welcome-ai";
import { localDesktopPage } from "./WelcomeGate";
import "../../styles/onboarding.css";
import "../../styles/place-setup.css";

type Config = ReturnType<typeof useStore>["state"]["config"];

/** A genuine first run on this computer's own page names the person after its account, where their profile has none
 * (never on a Cloud, a Team Cloud or a remote page). The name stays theirs to change in Settings. */
async function nameFromComputer(config: Config, done: (config: NonNullable<Config>) => void): Promise<void> {
  const bridge = window.duskDesktop;
  if (!config || config.onboarding?.completedAt || config.profile?.name?.trim() || config.cloudHome || config.team) return;
  if (!localDesktopPage() || bridge?.remoteClient?.active) return;
  const name = await bridge?.desktopProfile?.systemName().catch(() => null);
  if (!name) return;
  try {
    done(await api<NonNullable<Config>>("/api/config", { method: "PUT", body: JSON.stringify({ profile: { name } }), signal: AbortSignal.timeout(10_000) }));
  } catch {
  }
}

export { cloudBought } from "./funnel";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab stay inside `root`, the way a modal dialog keeps them. */
export function trapTab(event: ReactKeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
  if (event.key !== "Tab" || !root) return;
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** The first run, one calm screen at a time: the welcome, an account only where one is needed, an AI, and on a cloud the
 * desktop app set up that computer's bots. It ends in Dusk's chat (Dusk made the Chief of Staff where no other bot is
 * one), where Dusk greets and offers what is still missing. */
export function WelcomeFlow({
  onDone,
  replay = false,
  initialBeat,
  embedded = false,
  cloudHome: onCloud = false,
}: {
  onDone: (botId: string | null) => void;
  replay?: boolean;
  initialBeat?: BeatId;
  embedded?: boolean;
  /** the person's own cloud, which runs this first run when the desktop app that set it up opened it */
  cloudHome?: boolean;
}) {
  const { state, dispatch } = useStore();
  const maus = myDefaultBot(state.bots, useViewerEmail());
  const keepsDraft = !replay && !embedded;
  const root = useRef<HTMLDivElement>(null);
  const finishing = useRef(false);
  const record = useRef(state.config?.onboarding);
  record.current = state.config?.onboarding;

  // the account: asked once where this window can sign in; a step only for someone not signed in yet
  const account = useMemo(() => (embedded ? null : funnelAccount()), [embedded]);
  const [known, setKnown] = useState<FunnelAccountState | null>(null);
  const firstKnown = useRef<FunnelAccountState | null>(null);
  useEffect(() => {
    if (!account) return;
    let alive = true;
    const read = () => void account.state().then((next) => {
      if (!alive) return;
      firstKnown.current ??= next;
      setKnown(next);
    }, () => {});
    read();
    const stop = account.onChange(read);
    window.addEventListener("focus", read);
    return () => { alive = false; stop(); window.removeEventListener("focus", read); };
  }, [account]);
  const desktop = !embedded && localDesktopPage() && window.duskDesktop?.remoteClient?.active !== true;
  const draft = useMemo(() => (keepsDraft ? readWelcomeDraft() : null), [keepsDraft]);

  const cloudHome = !embedded && onCloud;
  const cloudBring = useCloudBringOffered(cloudHome && !replay);
  const [notesLine, setNotesLine] = useState<string | null>(null);

  const saved = initialBeat ?? draft?.beat;
  // every first run asks for an account (sign up or sign in); skipping stays possible but quiet, except where the install
  // requires one
  const accountStep = Boolean(account) && !firstKnown.current?.signedIn;
  // until the account's state is read, an install that may require one keeps the step
  const steps = funnelSteps({ account: accountStep, accountRequired: firstKnown.current ? firstKnown.current.required : true, desktop,
    hello: window.duskDesktop?.remoteClient?.active !== true, cloudBring });

  const [at, setAt] = useState<FunnelStep>(() => resumeBeat(steps, saved));
  // the second click of a double click lands on the step it opened: it must not choose there
  const stepShownAt = useRef(0);
  useEffect(() => { stepShownAt.current = Date.now(); }, [at]);
  const swallowDoubleClick = (event: { detail: number; preventDefault(): void; stopPropagation(): void }) => {
    if (event.detail < 2 || Date.now() - stepShownAt.current > 600) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const [from, setFrom] = useState<"next" | "back">("next");
  const tested = useWelcomeAi(state.instances);

  // each screen shown, with the path and how long the screen before it took: drop-off per step on the admin page
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    track("onboarding_step", { step: at, replay, ...(shownAt.current !== null ? { ms: now - shownAt.current } : {}) });
    shownAt.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, replay]);
  useEffect(() => {
    if (keepsDraft && !finishing.current) saveWelcomeDraft({ beat: at });
  }, [at, keepsDraft]);

  // A Cloud sheet opened over the welcome never switches the window away from it (CloudAddDialog).
  useEffect(() => (embedded ? undefined : showWelcome()), [embedded]);
  useEffect(() => {
    if (!replay && !embedded) void nameFromComputer(state.config, (config) => dispatch({ type: "configStatus", config }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // each step's title takes focus, so a screen reader hears where it is
  useEffect(() => {
    const title = root.current?.querySelector<HTMLElement>("#welcome-title");
    if (title && !root.current?.querySelector("[autofocus]")) title.focus({ preventScroll: true });
    else if (!title) root.current?.focus({ preventScroll: true });
  }, [at]);

  const finish = useCallback(
    async (reason: "completed" | "skipped", botId: string | null) => {
      if (finishing.current) return;
      finishing.current = true;
      track("onboarding_completed", { reason, at, replay });
      setEmailGateDone("submitted");
      if (!replay && !embedded) markWelcomeFinished();
      if (keepsDraft) clearWelcomeDraft();
      onDone(botId);
      try {
        const patch = replay ? completionPatch() : firstRunPatch(record.current, new Date(), { cloudHome });
        const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
        dispatch({ type: "configStatus", config });
      } catch {
      }
    },
    [at, dispatch, onDone, replay, embedded, keepsDraft, cloudHome],
  );

  // where it fits, Dusk becomes the Chief of Staff and greets in its chat, with no screen to ask
  const toChat = useCallback(() => {
    if (finishing.current) return;
    const chief = Boolean(maus && chiefStepFits(state.bots, maus));
    if (chief && maus) dispatch({ type: "updateBot", botId: maus.id, patch: createChiefPatch(maus, chiefFor(state.bots, maus)) });
    const botId = chief ? maus!.id : null;
    if (botId && !replay) stageIntro(botId);
    void finish(botId ? "completed" : "skipped", botId);
  }, [maus, state.bots, dispatch, finish, replay]);

  const go = useCallback((step: FunnelStep | null, direction: "next" | "back") => {
    if (!step) { if (direction === "next") toChat(); return; }
    setFrom(direction);
    setAt(step);
  }, [toChat]);
  const next = useCallback(() => go(nextStep(steps, at), "next"), [go, steps, at]);
  const back = previousStep(steps, at);

  useEffect(() => {
    if (at === "account" && !steps.includes("account")) setAt("ai");
  }, [at, steps]);

  // signing in in the browser comes back here by itself
  const signedOutSeen = useRef(false);
  useEffect(() => {
    if (at !== "account" || !known) return;
    if (!known.signedIn) signedOutSeen.current = true;
    else if (signedOutSeen.current) { signedOutSeen.current = false; next(); }
  }, [at, known, next]);

  // notes from another AI pasted on any step come in from here too (the bring step takes them itself, and says so there)
  const takeNotes = useNotesIntake();
  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const pasted = event.clipboardData.getData("text/plain");
    if (!looksLikeNotes(pasted)) return;
    event.preventDefault();
    takeNotes(pasted, setNotesLine);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      // Escape is "not now": past an optional step, never past an account the app needs
      if (at === "account" && known?.required) return;
      if (at === "welcome" || at === "account") return;
      next();
      return;
    }
    trapTab(event, root.current);
  };

  let body: ReactNode;
  switch (at) {
    case "welcome":
      body = <WelcomeStep onStart={next} cloud={cloudHome ? { name: greetingName(state.config?.profile?.name), picture: state.config?.profile?.avatarUrl || undefined } : undefined} />;
      break;
    case "account":
      body = account ? <AccountStep account={account} known={known}
        onDone={() => { track("onboarding_account", { action: "signed_in" }); next(); }}
        onSkip={known?.required ? null : () => { track("onboarding_account", { action: "skipped" }); next(); }} /> : null;
      break;
    case "ai":
      body = <AiStep tested={tested} auto={from === "next"} computerAis={cloudHome ? computerAiIds(state.config?.onboarding) : []} onNext={(how) => { track("onboarding_ai", { action: how }); next(); }} />;
      break;
    case "bring":
      body = <CloudBringStep onNext={next} />;
      break;
  }

  const index = steps.indexOf(at);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal
      aria-labelledby="welcome-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClickCapture={swallowDoubleClick}
      onPaste={onPaste}
      data-welcome={at}
      className={cn("welcome-screen flex overflow-y-auto bg-app outline-none", embedded ? "relative h-full w-full" : "fixed inset-y-0 left-[var(--rail-beside,0px)] right-0 z-50")}
    >
      {/* first, so the back button and every control after it stay clickable (styles.css) */}
      {!embedded && <WindowDragStrip />}
      {at !== "welcome" && steps.length > 1 && <FunnelBar at={index} count={steps.length} onBack={back ? () => go(back, "back") : null} />}
      <div key={at} data-from={from} className="place-step relative flex min-h-full w-full flex-col">
        {body}
      </div>
      {/* notes pasted on a step say how they went at its foot (the bring step says so itself) */}
      <BringStatus line={notesLine} />
    </div>
  );
}
