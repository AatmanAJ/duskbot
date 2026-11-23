import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { setEmailGateDone, track } from "@/lib/analytics";
import { openExternalLink } from "@/lib/app-links";
import { phoneAppEnabled } from "@/lib/feature-flags";
import { cn } from "@/lib/cn";
import { chiefFor, chiefStepFits, createChiefPatch, myDefaultBot, stageIntro, useViewerEmail } from "@/lib/default-bot";
import { completionPatch, DEFAULT_ADMIN_ORIGIN, firstRunPatch, markWelcomeFinished, resumeBeat, showWelcome, type BeatId } from "@/lib/onboarding";
import { clearWelcomeDraft, readWelcomeDraft, saveWelcomeDraft } from "@/lib/welcome-draft";
import { looksLikeNotes } from "@/lib/assistant-notes";
import { macPermissionsBridge, permissionsMissing, type MacPermissionStatus } from "@/lib/mac-permissions";
import { openPlaceSetup, usePlaceSetupOpen } from "@/lib/place-setup";
import { localSetupImport } from "@/lib/setup-import";
import { api, useStore } from "@/state/store";
import { useBotMove } from "../BringBots";
import { trapTab } from "./trap-tab";
import { useNotesIntake } from "../NotesWaiting";
import { WindowDragStrip } from "../DesktopCapabilities";
import { AccountStep } from "./AccountStep";
import { AiStep } from "./AiStep";
import { BringStatus, BringStep } from "./BringStep";
import { CheckoutStep, useCloudTile } from "./CheckoutStep";
import { funnelSteps, nextStep, previousStep, type FunnelPath, type FunnelStep } from "./funnel";
import { funnelAccount, type FunnelAccountState } from "./funnel-account";
import { FunnelBar, PhoneStep, PlaceStep, WelcomeStep } from "./FunnelSteps";
import { MakingStep } from "./MakingStep";
import { PermissionsStep } from "./PermissionsStep";
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

/** How long the first run looks for Grok bot's bots here before it settles on what it has: the steps before the bring
 * step take longer than this, so it is never waited on. */
export const FIRST_RUN_LOOK_MS = 30_000;

/** The first run, one calm screen at a time: the welcome, a dusk bot account, where the bots live, an AI, bots from
 * another app (only when there are some), the phone (while the phone app is offered). It ends in Dusk's chat (Dusk made the Chief of Staff where no other
 * bot is one), where Dusk greets and asks for whatever is still missing. On dusk cloud it is the browser (account, plan and
 * checkout there, this screen waiting beside it), the AI while the Cloud is made, then the Cloud, ending in that Cloud's chat. */
export function WelcomeFlow({
  onDone,
  replay = false,
  initialBeat,
  embedded = false,
}: {
  onDone: (botId: string | null) => void;
  replay?: boolean;
  initialBeat?: BeatId;
  embedded?: boolean;
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
    return () => { alive = false; stop(); };
  }, [account]);
  const desktop = !embedded && localDesktopPage() && window.duskDesktop?.remoteClient?.active !== true;
  const draft = useMemo(() => (keepsDraft ? readWelcomeDraft() : null), [keepsDraft]);
  // where the bots live, once picked; a resumed dusk cloud run past its checkout is paid for (the AI or the Cloud being made)
  const [path, setPath] = useState<FunnelPath | null>(draft?.cloud === true ? "cloud" : null);
  const [paid, setPaid] = useState(draft?.cloud === true && (draft.beat === "ai" || draft.beat === "making"));
  const [checkoutStart, setCheckoutStart] = useState(false);
  const cloud = path === "cloud";

  // the bring step is the prompt for AIs online; Grok bot's bots on this computer are looked for from the welcome on, in
  // the background, so the step can name them. What else this computer holds waits in Settings' import page.
  const offersMove = !replay && desktop && localSetupImport(state.config?.cloudHome === true);
  const move = useBotMove({ look: offersMove, downloads: false, ms: FIRST_RUN_LOOK_MS });
  // the Mac's permissions: read once, so the step stays put while the person grants them; offered until that read says
  // nothing is missing, which lets a run reopened on this step (Screen Recording needs that) land back on it
  const macAccess = useMemo(() => (desktop ? macPermissionsBridge() : null), [desktop]);
  const [firstAccess, setFirstAccess] = useState<MacPermissionStatus | null | undefined>(macAccess ? undefined : null);
  useEffect(() => {
    if (!macAccess) return;
    void macAccess.status().then((found) => setFirstAccess((known) => (known === undefined ? found : known)),
      () => setFirstAccess((known) => (known === undefined ? null : known)));
  }, [macAccess]);
  const permissions = Boolean(macAccess) && (firstAccess === undefined || permissionsMissing(firstAccess));
  const [notesLine, setNotesLine] = useState<string | null>(null);

  const saved = initialBeat ?? draft?.beat;
  // every first run asks for an account (sign up or sign in); skipping stays possible but quiet, except where the install
  // requires one
  const accountStep = Boolean(account) && !firstKnown.current?.signedIn;
  const stepsFor = (picked: FunnelPath | null) => funnelSteps({ account: accountStep, desktop, bring: offersMove,
    path: picked, hello: window.duskDesktop?.remoteClient?.active !== true, phone: phoneAppEnabled(), permissions });
  const steps = stepsFor(path);

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
  const cloudTile = useCloudTile(desktop);

  // each screen shown, with the path and how long the screen before it took: drop-off per step on the admin page
  const shownAt = useRef<number | null>(null);
  useEffect(() => {
    const now = Date.now();
    track("onboarding_step", { step: at, replay, ...(path ? { path } : {}), ...(shownAt.current !== null ? { ms: now - shownAt.current } : {}) });
    shownAt.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, replay]);
  useEffect(() => {
    if (keepsDraft && !finishing.current) saveWelcomeDraft({ beat: at, ...(cloud ? { cloud: true as const } : {}) });
  }, [at, keepsDraft, cloud]);

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
      track("onboarding_completed", { reason, at, replay, ...(path ? { path } : {}) });
      setEmailGateDone("submitted");
      if (!replay && !embedded) markWelcomeFinished();
      if (keepsDraft) clearWelcomeDraft();
      onDone(botId);
      try {
        const patch = replay ? completionPatch() : firstRunPatch(record.current, new Date());
        const config = await api("/api/config", { method: "PUT", body: JSON.stringify(patch), signal: AbortSignal.timeout(10_000) });
        dispatch({ type: "configStatus", config });
      } catch {
      }
    },
    [at, path, dispatch, onDone, replay, embedded, keepsDraft],
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
  const back = previousStep(steps, at, { paid });

  // signing in in the browser comes back here by itself
  const signedOutSeen = useRef(false);
  useEffect(() => {
    if (at !== "account" || !known) return;
    if (!known.signedIn) signedOutSeen.current = true;
    else if (signedOutSeen.current) { signedOutSeen.current = false; next(); }
  }, [at, known, next]);

  // dusk cloud: straight to the browser for the account, the plan and the checkout, with this screen waiting beside it.
  // Paid, the AI comes next while the Cloud is made. A window that can't buy here opens the plans page and goes on.
  const placeSheet = usePlaceSetupOpen();
  const chooseCloud = () => {
    track("onboarding_place", { choice: "cloud" });
    if (window.duskDesktop?.cloudAccount && window.duskDesktop.remoteClient?.active !== true) {
      setPath("cloud");
      setCheckoutStart(true);
      setFrom("next");
      setAt("checkout");
      return;
    }
    void openExternalLink(`${DEFAULT_ADMIN_ORIGIN}/pricing`).catch(() => {});
    next();
  };
  const cloudPaid = useCallback(() => {
    track("onboarding_cloud", { action: "bought" });
    setPaid(true);
    setFrom("next");
    setAt("ai");
  }, []);
  // this Mac, from the place step or from the browser's waiting screen: on to the step after the place
  const toMac = () => {
    setPath("mac");
    setCheckoutStart(false);
    setFrom("next");
    const step = nextStep(stepsFor("mac"), "place");
    if (step) setAt(step); else toChat();
  };
  const chooseMac = () => { track("onboarding_place", { choice: "mac" }); toMac(); };

  // notes from another AI pasted on any step come in from here too (the bring step takes them itself, and says so there)
  const takeNotes = useNotesIntake();
  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const pasted = event.clipboardData.getData("text/plain");
    if (!looksLikeNotes(pasted)) return;
    event.preventDefault();
    takeNotes(pasted, setNotesLine);
  };

  const overlayOpen = Boolean(placeSheet);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (event.defaultPrevented || overlayOpen) return;
      event.preventDefault();
      // Escape is "not now": past an optional step, never past an account the app needs
      if (at === "account" && known?.required) return;
      if (at === "welcome" || at === "account" || at === "place" || at === "checkout" || at === "making") return;
      next();
      return;
    }
    trapTab(event, root.current);
  };

  let body: ReactNode;
  switch (at) {
    case "welcome":
      body = <WelcomeStep onStart={next} />;
      break;
    case "account":
      body = account ? <AccountStep account={account} known={known}
        onDone={() => { track("onboarding_account", { action: "signed_in" }); next(); }}
        onSkip={known?.required ? null : () => { track("onboarding_account", { action: "skipped" }); next(); }} /> : null;
      break;
    case "place":
      body = <PlaceStep onMac={chooseMac} onCloud={chooseCloud} cloudTag={cloudTile.tag} cloudNote={cloudTile.note}
        onServer={() => { track("onboarding_place", { choice: "server" }); openPlaceSetup("way:cloudflare"); }} />;
      break;
    case "checkout":
      body = <CheckoutStep start={checkoutStart} onPaid={cloudPaid} onMac={toMac} />;
      break;
    case "ai":
      body = <AiStep tested={tested} cloud={cloud} auto={from === "next"} onNext={(how) => { track("onboarding_ai", { action: how }); next(); }} />;
      break;
    case "bring":
      body = <BringStep grokWaiting={move.plan?.grokWaiting ?? []} onNext={next} />;
      break;
    case "phone":
      body = <PhoneStep onNext={next} />;
      break;
    case "making":
      body = <MakingStep onOpened={() => void finish("completed", null)} />;
      break;
    case "permissions": {
      const relaunch = window.duskDesktop?.relaunch;
      body = macAccess ? <PermissionsStep bridge={macAccess} relaunch={relaunch ? () => void relaunch().catch(() => {}) : null}
        onNext={(how, granted) => { track("onboarding_permissions", { action: how, granted }); next(); }} /> : null;
      break;
    }
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
