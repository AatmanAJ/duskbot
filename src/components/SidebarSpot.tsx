import { useEffect, useRef, useState, type ReactNode } from "react";
import { GROK_HOVER_TINT } from "./SidebarSimpleTop";
import { Check } from "lucide-react";
import { X } from "../icons";

import { openExternalLink } from "@/lib/app-links";
import { cn } from "@/lib/cn";
import { openFeedback } from "@/lib/feedback-sheet";
import { t } from "@/lib/i18n";
import type { ServerUpdateCheck } from "@/lib/server-update";
import { api } from "@/state/api";

import type { AppUpdateBridge, AppUpdateState } from "../../electron/app-update.mjs";
import { Art, type ArtName } from "./ui/Art";

function ownBridge() {
  return window.duskDesktop?.remoteClient?.active === true ? undefined : window.duskDesktop?.appUpdate;
}

function restartInto(bridge: AppUpdateBridge, setRestarting: (on: boolean) => void) {
  setRestarting(true);
  void bridge.restart().then(ok => { if (!ok) setRestarting(false); }, () => setRestarting(false));
}

const NOTICE_EVERY_MS = 60 * 60_000;
const askServer = () => api<ServerUpdateCheck>("/api/updates/check", { background: true, timeoutMs: 20_000 });

/** The download page's newer release, for an app that can't install its own ("notice": Windows, Linux, an unsigned mac). */
function useNoticeRelease(on: boolean, check: () => Promise<ServerUpdateCheck>): { version: string; url: string } | null {
  const [release, setRelease] = useState<{ version: string; url: string } | null>(null);
  useEffect(() => {
    if (!on) { setRelease(null); return; }
    let active = true;
    const look = () => void check().then((answer) => {
      if (!active) return;
      const url = answer.releaseUrl;
      setRelease(answer.available && answer.install === "desktop" && answer.latest && url?.startsWith("https://dusk.bot/") ? { version: answer.latest, url } : null);
    }, () => {});
    look();
    const timer = window.setInterval(look, NOTICE_EVERY_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [on, check]);
  return release;
}

export type SpotState =
  | { kind: "feedback" }
  | { kind: "restart"; version: string; restarting: boolean }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "download-page"; version: string };

/**
 * The sidebar's one spot above the account row: Give feedback, until this computer's app has an update. A mac that installs
 * its own (electron/app-update.mjs) downloads it on a click and restarts into it once ready; an app that can't (Windows,
 * Linux, an unsigned build) opens the download page.
 */
export function useSidebarSpot(bridge: AppUpdateBridge | undefined = ownBridge(), check: () => Promise<ServerUpdateCheck> = askServer) {
  const [update, setUpdate] = useState<AppUpdateState>({ ready: null });
  const [asked, setAsked] = useState(false);
  const [restarting, setRestarting] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let heard = false;
    const unsubscribe = bridge.onState(state => { if (active) { heard = true; setUpdate(state); } });
    void bridge.state().then(state => { if (active && !heard) setUpdate(state); }, () => {});
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  const notice = useNoticeRelease(Boolean(bridge) && update.mode === "notice", check);
  const ready = update.ready;
  const version = ready ?? update.available ?? null;
  const progress = ready ? null : update.progress ?? null;
  useEffect(() => {
    if (!bridge || !asked || !ready) return;
    setAsked(false);
    restartInto(bridge, setRestarting);
  }, [bridge, asked, ready]);

  let spot: SpotState = { kind: "feedback" };
  if (bridge && ready) spot = { kind: "restart", version: ready, restarting };
  else if (bridge && version) spot = progress !== null || asked ? { kind: "downloading", version, percent: progress === null ? null : Math.round(progress * 100) } : { kind: "available", version };
  else if (notice) spot = { kind: "download-page", version: notice.version };

  const act = () => {
    if (spot.kind === "feedback") return openFeedback();
    if (spot.kind === "download-page") return void openExternalLink(notice!.url);
    if (!bridge) return;
    if (spot.kind === "restart") return restartInto(bridge, setRestarting);
    if (spot.kind === "downloading") return;
    setAsked(true);
    void bridge.download?.().then(found => { if (!found) setAsked(false); }, () => setAsked(false));
  };
  return { spot, act, updated: bridge ? update.updated ?? null : null, seen: () => void bridge?.seen?.(), bridge };
}

const FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const PRESS = "transition-[background-color,transform] duration-150 ease-[ease] active:scale-[0.98] motion-reduce:active:scale-100";
// the same pill as Connect apps below it: a hairline, the composer fill, and a tint laid over it on hover
const TONAL = `border border-ink/[0.08] bg-composer ${GROK_HOVER_TINT}`;
const BLUE = "bg-accent text-accent-ink hover:bg-[color-mix(in_srgb,var(--color-accent)_90%,black)] disabled:cursor-progress";

function spotWords(spot: Exclude<SpotState, { kind: "feedback" }>): { title: string; end: ReactNode; hint?: string } {
  if (spot.kind === "restart") return { title: t("appUpdate.restart"), end: spot.version, hint: t("appUpdate.title", { version: spot.version }) };
  if (spot.kind === "download-page") return { title: t("appUpdate.availableShort"), end: spot.version, hint: t("appUpdate.downloadPage", { version: spot.version }) };
  if (spot.kind === "downloading") return { title: t("appUpdate.downloadingShort"), end: spot.percent === null ? spot.version : t("appUpdate.percent", { percent: spot.percent }) };
  return { title: t("appUpdate.available", { version: spot.version }), end: null };
}

/** Something worth a press that takes Give feedback's place while it applies (the dusk cloud nudge, lib/cloud-nudge.ts).
 * Its own close ends it, and Give feedback comes back. An update always goes first. */
export interface SpotCta {
  /** names the offer on the card, `data-spot-cta` */
  id: string;
  title: string;
  hint?: string;
  art: ArtName;
  closeLabel: string;
  onStart: () => void;
  onClose: () => void;
}

const CARD = cn("flex h-10 w-full items-center gap-2.5 rounded-full px-3.5 text-start", PRESS, FOCUS);
/** the feedback card's look, for a card that sits beside the spot (SidebarBrowserCard) */
export const SPOT_CARD = cn(CARD, TONAL);

/** Give feedback, the update, or an offer: the same one-line card each time, so the spot only changes state. */
export function SidebarSpot({ className, bridge, check, cta = null }: {
  className?: string; bridge?: AppUpdateBridge; check?: () => Promise<ServerUpdateCheck>; cta?: SpotCta | null;
}) {
  return <SpotView className={className} state={useSidebarSpot(bridge ?? ownBridge(), check)} cta={cta} />;
}

export function SpotView({ className, state, cta = null }: { className?: string; state: ReturnType<typeof useSidebarSpot>; cta?: SpotCta | null }) {
  const { spot, act, updated, seen } = state;
  return (
    <div className={className}>
      {updated && spot.kind === "feedback" && <UpdatedNote version={updated} seen={seen} />}
      {spot.kind !== "feedback" ? <UpdateCard spot={spot} act={act} className={CARD} />
        : cta ? <SpotCtaCard cta={cta} />
        : (
          <button type="button" data-sidebar-spot="feedback" data-art-hover="" onClick={act} className={cn(CARD, TONAL)}>
            <Art name="bubbles" className="h-5 w-5 shrink-0 object-contain" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-ink">{t("giveFeedback.card")}</span>
          </button>
        )}
    </div>
  );
}

/** the offer as the feedback card's twin, with a close at its end; the close sits beside the card's button, never in it */
export function SpotCtaCard({ cta }: { cta: SpotCta }) {
  return (
    <div data-sidebar-spot="cta" data-spot-cta={cta.id} className="relative">
      <button type="button" data-spot-cta-start="" data-art-hover="" title={cta.hint} onClick={cta.onStart} className={cn(CARD, TONAL, "pe-10")}>
        <Art name={cta.art} className="h-5 w-5 shrink-0 object-contain" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5 text-ink">{cta.title}</span>
      </button>
      <button type="button" data-spot-cta-close="" aria-label={cta.closeLabel} title={cta.closeLabel} onClick={cta.onClose}
        className="absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-ink/56 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus">
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}

function UpdateCard({ spot, act, className }: { spot: Exclude<SpotState, { kind: "feedback" }>; act: () => void; className: string }) {
  const { title, end, hint } = spotWords(spot);
  const busy = spot.kind === "downloading" || (spot.kind === "restart" && spot.restarting);
  return (
    <button
      type="button"
      data-sidebar-spot="update"
      data-app-update={spot.version}
      data-app-update-state={spot.kind}
      title={hint}
      aria-busy={busy || undefined}
      disabled={spot.kind === "restart" && spot.restarting}
      onClick={act}
      className={cn(className, "@container relative isolate overflow-hidden", BLUE)}
    >
      {spot.kind === "downloading" && spot.percent !== null && (
        <span aria-hidden="true" data-app-update-progress="" className="absolute inset-0 -z-10 origin-left bg-[color-mix(in_srgb,var(--color-accent)_80%,black)] transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${spot.percent / 100})` }} />
      )}
      <Art name="parcel" className="h-5 w-5 shrink-0 object-contain" />
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5">{title}</span>
      {end !== null && <span className="hidden shrink-0 text-[12px] tabular-nums leading-4 text-accent-ink/75 @min-[13.5rem]:inline">{end}</span>}
    </button>
  );
}

/** The collapsed sidebar's form of the same spot: one round button over the account's. */
export function RailSpot({ bridge, check }: { bridge?: AppUpdateBridge; check?: () => Promise<ServerUpdateCheck> }) {
  const { spot, act } = useSidebarSpot(bridge ?? ownBridge(), check);
  const label = spot.kind === "feedback" ? t("giveFeedback.card") : spotWords(spot).title;
  return (
    <button
      type="button"
      data-sidebar-spot={spot.kind === "feedback" ? "feedback" : "update"}
      data-art-hover=""
      aria-label={spot.kind === "feedback" ? label : `${label}, ${spot.version}`}
      title={label}
      aria-busy={spot.kind === "downloading" || undefined}
      onClick={act}
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", PRESS, FOCUS, spot.kind === "feedback" ? TONAL : BLUE)}
    >
      <Art name={spot.kind === "feedback" ? "bubbles" : "parcel"} className="h-5 object-contain" />
    </button>
  );
}

const NOTE_MS = 20_000;

function UpdatedNote({ version, seen }: { version: string; seen: () => void }) {
  const said = useRef(seen);
  said.current = seen;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => { if (!timer && document.visibilityState === "visible") timer = setTimeout(() => said.current(), NOTE_MS); };
    look();
    document.addEventListener("visibilitychange", look);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", look); };
  }, [version]);
  return (
    <button
      type="button"
      data-app-updated={version}
      onClick={seen}
      className="mb-1 flex items-center gap-1.5 rounded-full px-3 py-[5px] text-[13px] leading-4 text-ink-secondary transition-colors duration-150 ease-out hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <Check size={13} aria-hidden="true" />
      {t("updates.updated", { version })}
    </button>
  );
}
