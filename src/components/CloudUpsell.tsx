import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { storeApp } from "@/lib/store-app";
import { Cloud, X } from "../icons";
import type { CloudSource } from "@/lib/cloud-plan";
import { investedBy, type InvestedFacts } from "../../shared/cloud-upsell";
import { firstChatQuiet, firstReplyPending } from "@/lib/corner-popup";
import { cloudUpsellAllowed, investedFacts, isInvested, markAlwaysOn, trackUpsell, watchUpsell } from "@/lib/cloud-upsell";
import { endNudge, nextNudgeAt, noteNudgeSession, nudgeDay, nudgeEligible, nudgeShowing, nudgeVersion, takeNudge, watchNudge } from "@/lib/cloud-nudge";
import { MASCOT_INK } from "@/lib/mascot";
import { CLOUD_INTRO, dismissNotice, INVESTED_NOTICE, LATE_ROUTINE_NOTICE, launchNotice, noticeSeen, watchLaunchNotice } from "@/lib/notices";
import { t } from "@/lib/i18n";
import { api, useDispatch, useStoreSelector, useStoreShallow, type AppState } from "@/state/store";
import { DuskMark } from "./mascot-view";
import { localDesktopPage } from "./onboarding/WelcomeGate";
import { useCloudPlan } from "./ProIntroduction";
import { deviceWord } from "./vps-link/parts";

const selectConfigLoaded = (state: AppState) => Boolean(state.config);
const selectCloudHome = (state: AppState) => Boolean(state.config?.cloudHome);
const selectManagedPolicy = (state: AppState) => Boolean(state.config?.managedPolicy);
const selectSettled = (state: AppState) => firstReplyPending(state) === false && !firstChatQuiet(state) && !state.welcomeOpen;
const selectOnboarding = (state: AppState) => state.config?.onboarding;
const selectInvested = (state: AppState) => isInvested(state);
const selectReplied = (state: AppState) => firstReplyPending(state) === false;

/** whether this computer's page may offer dusk cloud at all: someone who could buy it (signed out or free), no organization,
 * not already on a cloud or under a managed policy. null while the plan or organization is still loading. */
export function useCloudUpsell(): { allowed: boolean | null; open: (source: CloudSource) => void } {
  const dispatch = useDispatch();
  const configLoaded = useStoreSelector(selectConfigLoaded);
  const cloudHome = useStoreSelector(selectCloudHome);
  const managedPolicy = useStoreSelector(selectManagedPolicy);
  const plan = useCloudPlan();
  const organization = window.duskDesktop?.organization;
  const [managed, setManaged] = useState<boolean | null>(organization ? null : false);
  useEffect(() => {
    if (!organization) return;
    let active = true, updated = false;
    const accept = (next: Awaited<ReturnType<typeof organization.state>>) => {
      if (active) setManaged(next.status !== "signed-out" && Boolean(next.organization));
    };
    const unsubscribe = organization.onState(next => { updated = true; accept(next); });
    void organization.state().then(next => { if (!updated) accept(next); }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, [organization]);
  const here = !storeApp() && localDesktopPage() && window.duskDesktop?.remoteClient?.active !== true && configLoaded
    && !cloudHome && !managedPolicy;
  const allowed = cloudUpsellAllowed({ here, view: plan?.view ?? null, managed });
  const signedOut = plan?.view.kind === "signed-out";
  const open = (source: CloudSource) => dispatch({ type: "openCloudAdd", source, ...(signedOut ? { signIn: true as const } : {}) });
  return { allowed, open };
}

/** a sleeping pixel bot that looks up while the pointer is on it */
function NappingBot({ size }: { size: number }) {
  const [near, setNear] = useState(false);
  return <span aria-hidden="true" className="shrink-0" onPointerEnter={event => { if (event.pointerType === "mouse") setNear(true); }} onPointerLeave={() => setNear(false)}>
    <DuskMark body="wisp" colour={MASCOT_INK.purple} state="sleeping" size={size} emphasized={near} label={null} />
  </span>;
}

const CLOUD_NOTICES = new Set<string>([CLOUD_INTRO, LATE_ROUTINE_NOTICE]);
const INVESTED_LINE = { bots: "cloudUpsell.invested.bots", messages: "cloudUpsell.invested.messages", routines: "cloudUpsell.invested.routines" } as const;
// the invested pitch holds the card for the rest of the launch it first showed in
let launchInvested: InvestedFacts | null = null;

/** the small dusk cloud card at the foot of the sidebar, a few times on a day the app is used (lib/cloud-nudge.ts), never
 * during first run. A launch that already showed a cloud notice in the corner leaves it out, so the pitch is said once.
 * Someone clearly invested (shared/cloud-upsell.ts INVESTED) gets it in their own numbers instead, once per account. */
export function SidebarCloudCard() {
  const dispatch = useDispatch();
  const settled = useStoreSelector(selectSettled);
  const record = useStoreSelector(selectOnboarding);
  const investedNow = useStoreSelector(selectInvested);
  const facts = useStoreShallow(investedFacts);
  const { allowed, open } = useCloudUpsell();
  const [held, setHeld] = useState<InvestedFacts | null>(launchInvested);
  const [, setTick] = useState(0);
  useSyncExternalStore(watchNudge, nudgeVersion, nudgeVersion);
  // a corner cloud card claiming this launch hides this one right away: one dusk cloud offer on screen at a time
  const notice = useSyncExternalStore(watchLaunchNotice, launchNotice, () => null);
  const eligible = nudgeEligible({ allowed, settled, cornerCard: Boolean(notice && CLOUD_NOTICES.has(notice)) });
  const showing = nudgeShowing();
  const visible = eligible && showing;
  const due = visible && !held && !noticeSeen(record, INVESTED_NOTICE) && investedNow ? facts : null;
  const invested = held ?? due;
  const by = invested ? investedBy(invested) : null;
  const source: CloudSource = by ? "app_invested" : "app_sidebar";
  useEffect(() => { noteNudgeSession(); }, []);
  // not showing yet: start a showing when one is due, or wake up when the next one will be
  useEffect(() => {
    if (!eligible || showing) return;
    if (takeNudge()) return;
    const at = nextNudgeAt(nudgeDay());
    if (at === null) return;
    const timer = setTimeout(() => setTick(tick => tick + 1), Math.min(Math.max(at - Date.now(), 1000), 2 ** 31 - 1));
    return () => clearTimeout(timer);
  });
  const reported = useRef(false);
  useEffect(() => {
    if (!visible || reported.current) return;
    reported.current = true;
    trackUpsell("shown", source);
    if (!due) return;
    launchInvested = due;
    setHeld(due);
    const patch = dismissNotice(record, INVESTED_NOTICE);
    if (patch) void api("/api/config", { method: "PUT", body: JSON.stringify(patch) }).then(config => dispatch({ type: "configStatus", config })).catch(() => {});
  }, [visible]);
  useEffect(() => { if (!visible) reported.current = false; }, [visible]);
  useEffect(() => { if (visible) return watchUpsell(source); }, [visible, source]);
  if (!visible) return null;
  return <SidebarCloudNudge invested={invested && by ? { by, count: invested[by] } : null}
    onDismiss={() => { trackUpsell("dismiss", source); endNudge(true); }}
    onStart={() => { trackUpsell("click", source); endNudge(); open(source); }} />;
}

/** the card itself: the bot panel's Keep it working pitch made small for the sidebar, or the invested line */
export function SidebarCloudNudge({ invested, onDismiss, onStart }: {
  invested: { by: keyof InvestedFacts; count: number } | null; onDismiss: () => void; onStart: () => void;
}) {
  const device = deviceWord();
  return (
    <section aria-labelledby="sidebar-cloud-title" data-sidebar-cloud-card="" data-invested={invested ? "" : undefined}
      className="relative mb-2 rounded-xl bg-composer p-3 text-ink ring-[0.5px] ring-transparent [@media(max-height:600px)]:hidden">
      <button type="button" onClick={onDismiss} aria-label={t("cloudUpsell.hide")}
        className="absolute end-1.5 top-1.5 flex size-6 cursor-pointer items-center justify-center rounded-full text-ink/56 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
        <X size={13} aria-hidden="true" />
      </button>
      <div className="flex items-start gap-2.5 pe-5">
        {invested ? <span aria-hidden="true" className="shrink-0"><DuskMark body="kit" colour={MASCOT_INK.blue} state="happy" size={30} label={null} /></span> : <NappingBot size={30} />}
        <div className="min-w-0">
          <h2 id="sidebar-cloud-title" className="m-0 text-[13px] font-semibold leading-[1.35] text-ink [text-wrap:pretty]">
            {invested ? t(INVESTED_LINE[invested.by], { count: invested.count }) : t("cloudUpsell.nudge.title")}</h2>
          <p className="m-0 mt-0.5 text-[12px] font-medium leading-[1.45] text-ink-secondary [text-wrap:pretty]">
            {t(invested ? "cloudUpsell.invested.body" : "cloudUpsell.nudge.body", { device })}</p>
        </div>
      </div>
      <button type="button" data-sidebar-cloud-start="" className="ui-button ui-button-primary mt-2.5 w-full justify-center gap-1.5" onClick={onStart}>
        <Cloud size={13} aria-hidden="true" />{t("rail.buy")}
      </button>
    </section>
  );
}

/** the 24/7 line inside a flow that makes something run on its own (a schedule, an app event, another app sending
 * something) on this computer: it only runs while the computer is awake. Seeing it starts the same cooldown as the
 * new-routine dialog, so that dialog does not repeat it. */
export function AlwaysOnNote({ className }: { className?: string }) {
  const { allowed, open } = useCloudUpsell();
  const replied = useStoreSelector(selectReplied);
  const shown = useRef(false);
  const visible = allowed === true && replied;
  useEffect(() => {
    if (!visible || shown.current) return;
    shown.current = true;
    markAlwaysOn();
    trackUpsell("shown", "app_always_on");
  }, [visible]);
  useEffect(() => { if (visible) return watchUpsell("app_always_on"); }, [visible]);
  if (!visible) return null;
  return (
    <p data-always-on-note="" className={`m-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px] leading-4 text-ink-secondary ${className ?? ""}`}>
      <span>{t("cloudUpsell.alwaysOn", { device: deviceWord() })}</span>
      <button type="button" className="cursor-pointer rounded-[4px] font-medium text-accent-text underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        onClick={() => { trackUpsell("click", "app_always_on"); open("app_always_on"); }}>{t("cloudUpsell.alwaysOnAction")}</button>
    </p>
  );
}
