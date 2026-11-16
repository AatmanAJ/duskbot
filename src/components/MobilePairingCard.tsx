import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ExternalLink, KeyRound, QrCode } from "../icons";
import { QRCodeSVG } from "qrcode.react";

import type { MobileDevice, MobilePairingRequest, MobilePairingResponse } from "../../shared/mobile-link";
import { companionBridge } from "@/lib/companion-bridge";
import { copyText, type CopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { requireUserPresence } from "@/lib/user-presence";
import { api, ApiError } from "@/state/store";
import { lastSeen, minutesLeft } from "../lib/pairing-time";
import { haptic } from "../mobile/haptics";
import { dur, ease } from "../mobile/motion";
import { Card as RowsCard, CopyRow, ItemRow } from "./ListRows";
import { PlaceArt, type PlaceArtName } from "./ui/PlaceArt";
import { PRIMARY, ProgressInk, QUIET, SECONDARY, TILE } from "./onboarding/FunnelSteps";
import type { PairedDevice } from "./ServerPairingCard";
import { friendlyError } from "@/lib/plain-error";
import { storeUrl } from "../mobile/connection/phone-update";

export function platformLabelKey(platform: string) {
  return platform === "ios" ? "settings.mobile.ios" : platform === "android" ? "settings.mobile.android" : "settings.mobile.phone";
}

export function newDeviceSince(before: readonly string[], after: readonly MobileDevice[]): MobileDevice | null {
  const known = new Set(before);
  return after.find((device) => !known.has(device.id)) ?? null;
}

/** a cloud's phones are its full-access sign-ins other than this window's own */
export function cloudPhones(sessions: readonly PairedDevice[], current: string | null): PairedDevice[] {
  return sessions.filter((session) => session.scopes.includes("admin") && session.id !== current);
}

const pill = "rounded-full bg-ink/5 px-2 py-0.5 text-[12px] leading-4 text-ink-secondary";
const quietButton = cn(QUIET, "font-medium hover:bg-ink/5 disabled:opacity-50");

/** The phone page's pieces, for a caller that lays them out around its own pairing code. */
export interface PhoneParts {
  /** the guided flow, or the short header over the linked phones once one is in */
  top: ReactNode;
  /** the flow is on screen: the caller keeps its own extras out of the way */
  stepping: boolean;
  phones: ReactNode;
}

type Way = "qr" | "code";
type Flow = "loading" | "home" | "platform" | "store" | "link";
const STEPS: readonly Flow[] = ["platform", "store", "link"];

/** a live code is swapped for a new one this long before it ends, so the screen never shows a dead code */
export const RENEW_BEFORE_MS = 60_000;
/** silent swaps after the one the person asked for: about an hour with the step open, then it ends and says so */
export const AUTO_RENEWALS = 5;

export function MobilePairingCard({ remote, cloudHome = false, email, children }: {
  remote: boolean;
  /** a dusk cloud refuses phone codes (server/index.ts createMobileLink refusal): the iPhone app reaches it by signing in */
  cloudHome?: boolean;
  /** the account's email, named in the sign-in step */
  email?: string;
  /** lays the pieces out; null when this workspace may not link phones */
  children?: (phone: PhoneParts | null) => ReactNode;
}) {
  const [devices, setDevices] = useState<MobileDevice[] | null>(null);
  const [cloudSignIns, setCloudSignIns] = useState<PairedDevice[] | null>(null);
  const signInsSeen = useRef(cloudSignIns);
  signInsSeen.current = cloudSignIns;
  const [offer, setOffer] = useState<MobilePairingResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [flow, setFlow] = useState<Flow>("loading");
  const [way, setWay] = useState<Way>("qr");
  const linking = useRef(false);
  linking.current = flow === "link";
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const [pairedName, setPairedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const renewals = useRef(0);
  const baseline = useRef<string[] | null>(null);
  const cloudBaseline = useRef<string[] | null>(null);
  const linkId = useId();
  const stepId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const reducedMotion = useReducedMotion();

  const loadDevices = useCallback(async (epoch: number) => {
    try {
      const body = await api<{ devices: MobileDevice[]; current: string | null }>("/api/mobile/devices");
      if (generation.current !== epoch) return;
      setDevices(body.devices);
      if (!cloudHome) setFlow((at) => at === "loading" ? (body.devices.length ? "home" : "platform") : at);
      if (baseline.current) {
        const added = newDeviceSince(baseline.current, body.devices);
        if (added) {
          baseline.current = null;
          setOffer(null);
          setPairedName(added.name);
          haptic("success");
        }
      }
    } catch (cause) {
      if (generation.current !== epoch) return;
      if (cause instanceof ApiError && cause.status === 403) {
        baseline.current = null;
        setOffer(null);
        setHidden(true);
      } else {
        setError(friendlyError(cause, t("settings.mobile.error")));
        if (!cloudHome) setFlow((at) => at === "loading" ? "platform" : at);
        haptic("error");
      }
    }
  }, [cloudHome]);

  // a cloud's phone signs in with the account, so it shows up with the cloud's sign-ins
  const loadCloudSignIns = useCallback(async (epoch: number) => {
    try {
      const body = await api<{ sessions?: PairedDevice[]; current?: string | null }>("/api/auth/sessions");
      if (generation.current !== epoch) return;
      const phones = cloudPhones(Array.isArray(body?.sessions) ? body.sessions : [], typeof body?.current === "string" ? body.current : null);
      setCloudSignIns(phones);
      setFlow((at) => at === "loading" ? (phones.length ? "home" : "platform") : at);
      if (cloudBaseline.current) {
        const known = new Set(cloudBaseline.current);
        const added = phones.find((session) => !known.has(session.id));
        if (added) {
          cloudBaseline.current = null;
          setPairedName(added.label);
          haptic("success");
        }
      }
    } catch {
      if (generation.current === epoch) setFlow((at) => at === "loading" ? "platform" : at);
    }
  }, []);

  useEffect(() => {
    const epoch = ++generation.current;
    baseline.current = null;
    cloudBaseline.current = null;
    setDevices(null);
    setCloudSignIns(null);
    setOffer(null);
    setHidden(false);
    setBusy(false);
    setRemoving(null);
    setPairedName(null);
    setShowLink(false);
    setFlow("loading");
    setWay("qr");
    setError(null);
    moved.current = false;
    void loadDevices(epoch);
    if (cloudHome) void loadCloudSignIns(epoch);
    return () => { generation.current += 1; };
  }, [loadDevices, loadCloudSignIns, remote, cloudHome]);

  useEffect(() => {
    if (!offer) return;
    const epoch = generation.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    const poll = async () => {
      await loadDevices(epoch);
      if (!cancelled) timer = setTimeout(() => void poll(), 2_000);
    };
    timer = setTimeout(() => void poll(), 2_000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(clock); };
  }, [loadDevices, offer]);

  // on a cloud's sign-in step, watch for the phone's own sign-in
  useEffect(() => {
    if (!cloudHome || flow !== "link" || pairedName !== null) return;
    const epoch = generation.current;
    cloudBaseline.current = (signInsSeen.current ?? []).map((session) => session.id);
    const poll = setInterval(() => void loadCloudSignIns(epoch), 3_000);
    return () => { clearInterval(poll); cloudBaseline.current = null; };
  }, [cloudHome, flow, pairedName, loadCloudSignIns]);

  // while its step is open, a code is replaced before it ends; the old one keeps working until its own end
  useEffect(() => {
    if (!offer || flow !== "link" || pairedName !== null || renewals.current >= AUTO_RENEWALS) return;
    const epoch = generation.current;
    const timer = setTimeout(() => {
      renewals.current += 1;
      void mint().then((body) => {
        if (generation.current === epoch && linking.current) { setOffer(body); setNow(Date.now()); }
      }).catch(() => {});
    }, Math.max(0, offer.expiresAt - RENEW_BEFORE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [offer, flow, pairedName]);

  /** Shows a way's code; a live offer is reused, since it carries both the qr's link and the typed code. */
  async function create(fresh = false) {
    if (busy || !devices) return;
    setCopied("idle");
    if (!fresh && offer && offer.expiresAt > Date.now() && pairedName === null) return;
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    setShowLink(false);
    setPairedName(null);
    setOffer(null);
    baseline.current = null;
    renewals.current = 0;
    try {
      if (!(await requireUserPresence()) || generation.current !== epoch) return;
      const body = await mint();
      if (generation.current !== epoch) return;
      baseline.current = devices.map((device) => device.id);
      setOffer(body);
      setNow(Date.now());
      haptic("success");
    } catch (cause) {
      if (generation.current === epoch) {
        setError(friendlyError(cause, t("settings.mobile.error")));
        haptic("error");
      }
    } finally {
      if (generation.current === epoch) setBusy(false);
    }
  }

  async function mint(): Promise<MobilePairingResponse> {
    const request: MobilePairingRequest = {};
    const companion = remote ? null : companionBridge();
    if (companion) {
      try {
        request.companion = (await companion.start()).endpoints;
      } catch {}
    }
    return api<MobilePairingResponse>("/api/mobile/pairing", { method: "POST", body: JSON.stringify(request) });
  }

  function go(to: Flow) {
    moved.current = true;
    setError(null);
    if (to !== "link") setPairedName(null);
    setFlow(to);
    if (to === "link" && !cloudHome) void create();
  }

  function finish() {
    setPairedName(null);
    setOffer(null);
    go("home");
  }

  async function remove(id: string) {
    const epoch = generation.current;
    setRemoving(id);
    setError(null);
    try {
      await api(`/api/mobile/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (generation.current === epoch) await loadDevices(epoch);
    } catch (cause) {
      if (generation.current === epoch) {
        setError(friendlyError(cause, t("settings.mobile.error")));
        haptic("error");
      }
    } finally {
      if (generation.current === epoch) setRemoving(null);
    }
  }

  async function copyCode() {
    if (!offer?.code) return;
    const epoch = generation.current;
    const result = await copyText(offer.code);
    if (generation.current === epoch && result !== "empty") {
      setCopied(result);
      if (result === "failed") haptic("error");
    }
  }

  if (hidden) return children ? <>{children(null)}</> : null;
  const expired = offer !== null && offer.expiresAt <= now;
  const linked = pairedName !== null;
  const groupedCode = offer?.code?.replace(/[^a-z0-9]/gi, "").match(/.{1,4}/g)?.join(" ");
  const hasPhones = cloudHome ? (cloudSignIns?.length ?? 0) > 0 : (devices?.length ?? 0) > 0;
  const view = flow === "link" && linked ? "done" : flow;
  const at = STEPS.indexOf(flow);
  const back = flow === "store" ? "platform" : flow === "link" && !linked ? "store" : flow === "platform" && hasPhones ? "home" : null;
  const signInEmail = email?.trim();

  const motionProps = {
    initial: { opacity: 0, y: reducedMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reducedMotion ? 0 : -4 },
    transition: { duration: reducedMotion ? 0 : dur.base, ease: ease.out },
  };

  const heading = (title: ReactNode, sub?: ReactNode, art?: PlaceArtName) => (
    <div className="flex flex-col items-center text-center">
      {art && <PlaceArt name={art} size={52} className="place-mark mb-4" />}
      <h3 id={stepId} ref={stepHeading} tabIndex={-1} className="m-0 text-balance text-[22px] font-normal leading-7 tracking-[-0.02em] text-ink outline-none">{title}</h3>
      {sub && <p className="m-0 mt-1.5 max-w-[400px] text-pretty text-[14px] leading-5 text-ink-secondary">{sub}</p>}
    </div>
  );

  const waiting = (line: ReactNode) => (
    <p role="status" className="m-0 flex items-center justify-center gap-2 text-[13px] leading-[18px] text-ink-tertiary">
      <span aria-hidden="true" className="phone-link-wait inline-block size-1.5 shrink-0 rounded-full bg-ink-secondary" />
      {line}
    </p>
  );

  const errorLine = error && <p role="alert" className="m-0 text-center text-[13px] leading-[18px] text-danger">{error}</p>;

  const platformCard = (kind: "ios" | "android") => {
    const ios = kind === "ios";
    return (
      <button type="button" data-phone-platform={kind} disabled={!ios} onClick={() => { haptic("selection"); go("store"); }}
        className={cn(TILE, "flex min-w-0 flex-col items-start gap-3 p-5 text-start disabled:pointer-events-none disabled:opacity-55")}>
        <span className="flex w-full items-start justify-between gap-2">
          <PlaceArt name="phone" size={44} />
          <span className={pill}>{t(ios ? "settings.phone.iphoneTag" : "settings.phone.androidTag")}</span>
        </span>
        <span className="text-[15px] font-semibold leading-5 text-ink">{t(ios ? "settings.phone.iphone" : "settings.phone.android")}</span>
        <span className="text-[13px] leading-[18px] text-ink-secondary">{t(ios ? "settings.phone.iphoneSub" : "settings.phone.androidSub")}</span>
      </button>
    );
  };

  const platformStep = (
    <div className="flex flex-col items-center gap-6">
      {heading(t("settings.phone.getTitle"), t("settings.phone.getSub"))}
      <div data-phone-platforms="" className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">{platformCard("ios")}{platformCard("android")}</div>
      <button type="button" data-phone-have-app="" onClick={() => go("link")} className={quietButton}>{t("settings.phone.haveApp")}</button>
      {errorLine}
    </div>
  );

  // the app first: the store's qr here, the pairing one in the next step, never both
  const storeStep = (
    <div data-phone-store-step="" className="flex flex-col items-center gap-6">
      {heading(t("mobile.cloud.getApp"), t("settings.mobile.storeStep"))}
      <div role="img" aria-label={t("mobile.cloud.storeQr")} className="flex size-[164px] items-center justify-center rounded-[16px] bg-white p-2.5">
        <QRCodeSVG value={storeUrl("ios")} size={144} level="M" includeMargin={false} bgColor="#ffffff" fgColor="#1b1b1f" aria-hidden="true" />
      </div>
      <div className="flex w-full flex-col items-center gap-2">
        <button type="button" data-primary="" data-phone-installed="" onClick={() => { haptic("selection"); go("link"); }} className={PRIMARY}>{t("settings.phone.installed")}</button>
        <a data-phone-app-store="" href={storeUrl("ios")} target="_blank" rel="noreferrer" className={cn(SECONDARY, "inline-flex items-center justify-center gap-1.5")}>
          {t("settings.phone.openStore")}<ExternalLink aria-hidden="true" size={14} />
        </a>
      </div>
    </div>
  );

  const wayCard = (kind: Way) => {
    const qr = kind === "qr";
    const chosen = way === kind;
    return (
      <button type="button" data-pairing-tile={kind} {...(qr ? { "data-phone-pair": "" } : { "data-phone-code": "" })} aria-pressed={chosen}
        onClick={() => { haptic("selection"); setWay(kind); setCopied("idle"); if (!offer && !busy) void create(); }}
        className={cn(TILE, "flex min-h-[64px] min-w-0 items-center gap-3 px-4 py-3 text-start", chosen && "bg-ink/[0.08] hover:bg-ink/[0.08]")}>
        <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150", chosen ? "bg-ink text-app" : "bg-ink/5 text-ink-secondary")}>
          {qr ? <QrCode size={18} /> : <KeyRound size={18} />}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-medium leading-5 text-ink">{t(qr ? "settings.mobile.scanTitle" : "settings.w6.pairing.title")}</span>
          <span className="text-[12px] leading-4 text-ink-secondary">{t(qr ? "settings.mobile.scanLine" : "settings.mobile.codeLine")}</span>
        </span>
      </button>
    );
  };

  const qrWay = way === "qr";
  const scanOnly = !qrWay && offer !== null && offer.code === null;
  const failed = error !== null && offer === null && !busy;
  const pairing = (
    <div data-pairing-step={way} className="flex w-full flex-col items-center gap-4">
      {failed ? (
        <div data-pairing-failed="" className="flex min-h-[164px] max-w-[360px] flex-col items-center justify-center gap-3 text-center">
          <PlaceArt name="error" size={44} />
          <p role="alert" className="m-0 text-[13px] leading-[18px] text-ink-secondary">{error}</p>
          <button type="button" onClick={() => void create(true)} className="ui-button ui-button-pill min-h-11">{t("settings.phone.tryAgain")}</button>
        </div>
      ) : expired ? (
        <div className="flex min-h-[164px] flex-col items-center justify-center gap-3">
          <PlaceArt name="expired" size={44} />
          <p role="status" className="m-0 text-[13px] leading-[18px] text-ink-secondary">{t("settings.mobile.expired")}</p>
          <button type="button" onClick={() => void create(true)} disabled={busy} className="ui-button ui-button-pill min-h-11">{t("settings.mobile.newCode")}</button>
        </div>
      ) : qrWay ? (
        <div role="img" aria-label={t("settings.mobile.qr")} aria-busy={!offer} className="flex size-[184px] items-center justify-center rounded-[16px] bg-white p-2.5">
          {offer ? <QRCodeSVG value={offer.link} size={164} level="M" includeMargin={false} bgColor="#ffffff" fgColor="#1b1b1f" aria-hidden="true" />
            : <span className="size-[164px] animate-pulse rounded-[8px] bg-[#1b1b1f]/[0.06] motion-reduce:animate-none" />}
        </div>
      ) : scanOnly ? (
        <div data-pairing-scan-only="" className="flex min-h-[96px] flex-col items-center justify-center gap-3">
          <p className="m-0 max-w-[320px] text-center text-[14px] leading-5 text-ink-secondary">{t("settings.mobile.scanOnly")}</p>
          <button type="button" onClick={() => { haptic("selection"); setWay("qr"); }} className="ui-button ui-button-pill min-h-11">{t("settings.mobile.scanInstead")}</button>
        </div>
      ) : (
        <div className="flex min-h-[96px] items-center justify-center rounded-[16px] bg-ink/[0.035] px-6">
          {offer ? <code aria-label={t("settings.mobile.code")} className="select-all whitespace-nowrap font-mono text-[22px] leading-8 tracking-[0.1em] text-ink">{groupedCode}</code>
            : <span aria-hidden="true" className="h-8 w-[220px] animate-pulse rounded-[8px] bg-ink/[0.06] motion-reduce:animate-none" />}
        </div>
      )}
      {!failed && !expired && !scanOnly && (
        <p className="m-0 max-w-[340px] text-center text-[13px] leading-[18px] text-ink-secondary">{t(qrWay ? "settings.phone.scanSteps" : "settings.docs.phone.codeSteps")}</p>
      )}
      {offer && !expired && waiting(<>{t("mobile.desktop.waiting")} · {renewals.current < AUTO_RENEWALS
        ? t("settings.mobile.renews", { minutes: minutesLeft(offer.expiresAt - RENEW_BEFORE_MS, now) })
        : t("settings.mobile.expires", { minutes: minutesLeft(offer.expiresAt, now) })}</>)}
      {offer && !expired && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <button type="button" data-phone-new-code="" onClick={() => void create(true)} disabled={busy} className={quietButton}>{t("settings.mobile.newCode")}</button>
          {qrWay ? (
            <button type="button" aria-expanded={showLink} aria-controls={linkId} onClick={() => { setShowLink(!showLink); haptic("selection"); }} className={quietButton}>
              {t("mobile.desktop.copyLinkInstead")}
            </button>
          ) : offer.code ? (
            <button type="button" onClick={() => void copyCode()} className={quietButton} aria-live="polite">
              {t(copied === "copied" ? "settings.mobile.copied" : copied === "failed" ? "settings.mobile.copyFailed" : "settings.mobile.copyCode")}
            </button>
          ) : null}
        </div>
      )}
      {qrWay && offer && (
        <div id={linkId} hidden={!showLink} className="w-full max-w-[420px] text-start [&_button]:min-h-11 [&_button]:min-w-11">
          {showLink && <CopyRow title={t("settings.mobile.link")} text={offer.link} copyLabel={t("settings.mobile.copyLink")} />}
        </div>
      )}
    </div>
  );

  const linkStep = cloudHome ? (
    // a cloud: no code to make, the app finds the cloud from the account
    <div data-phone-cloud="" className="flex flex-col items-center gap-6">
      {heading(t("settings.phone.cloudTitle"), t(signInEmail ? "settings.phone.cloudSub" : "settings.phone.cloudSubAny"), "cloud")}
      {signInEmail && (
        <div data-phone-cloud-sign-in="" className="flex w-full max-w-[360px] flex-col items-center gap-0.5 rounded-[16px] bg-ink/[0.035] px-5 py-4">
          <span className="text-[12px] leading-4 text-ink-tertiary">{t("settings.phone.email")}</span>
          <span className="max-w-full break-all text-[15px] font-medium leading-5 text-ink">{signInEmail}</span>
        </div>
      )}
      {waiting(t("settings.phone.waitingCloud"))}
      <button type="button" data-primary="" data-phone-cloud-done="" onClick={finish} className={PRIMARY}>{t("common.done")}</button>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-6">
      {heading(t("mobile.desktop.title"), t("settings.phone.linkSub"))}
      <div data-pairing-ways="" className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">{wayCard("qr")}{wayCard("code")}</div>
      {pairing}
      {!failed && errorLine}
    </div>
  );

  const doneStep = (
    <div role="status" data-phone-linked="" className="flex flex-col items-center gap-6">
      {heading(cloudHome ? t("settings.phone.cloudLinked") : t("mobile.desktop.linked", { name: pairedName ?? "" }), t("mobile.desktop.linkedHint"), "connected")}
      <button type="button" data-primary="" onClick={finish} className={PRIMARY}>{t("common.done")}</button>
    </div>
  );

  const loadingStep = <div aria-hidden="true" className="h-[280px] animate-pulse rounded-[16px] bg-ink/[0.035] motion-reduce:animate-none" />;

  const bar = at >= 0 && (
    <div className="relative flex h-11 items-center justify-center">
      {back && (
        <button type="button" data-pairing-back="" onClick={() => go(back)}
          className="absolute start-0 inline-flex min-h-11 items-center gap-0.5 rounded-full py-1 pe-3 ps-1.5 text-[13px] leading-[18px] text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
          <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" className="rtl:-scale-x-100" />{t("common.back")}
        </button>
      )}
      <div role="progressbar" aria-label={t("settings.phone.progress")} aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={at + 1}
        aria-valuetext={t("funnel.progressAt", { at: String(at + 1), count: String(STEPS.length) })} data-phone-progress={`${at + 1}/${STEPS.length}`}
        className="relative flex items-center gap-1.5">
        {STEPS.map((step, index) => <span key={step} aria-hidden="true" className={cn("h-1 rounded-full bg-ink/12", index === at ? "w-6" : "w-3")} />)}
        <ProgressInk at={linked ? STEPS.length - 1 : at} />
      </div>
    </div>
  );

  const steps: Record<Exclude<typeof view, "home">, ReactNode> = { loading: loadingStep, platform: platformStep, store: storeStep, link: linkStep, done: doneStep };

  const top = view === "home" ? (cloudHome ? (
    <RowsCard label={t("settings.phone.linkedTitle")} action={<LinkAnother onClick={() => go("platform")} />}>
      <ItemRow pixel="phone" title={t("settings.phone.cloudHome")} hint={signInEmail ? t("settings.phone.cloudHomeHint", { email: signInEmail }) : t("settings.phone.cloudHomeHintAny")} />
    </RowsCard>
  ) : null) : (
    <section aria-labelledby={stepId} data-phone-flow={view} className="mx-auto flex w-full max-w-[560px] flex-col gap-4 pb-2">
      {bar}
      {/* focus follows the swap once the old step has left */}
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => requestAnimationFrame(() => { if (moved.current) stepHeading.current?.focus({ preventScroll: true }); })}>
        <motion.div key={view} {...motionProps}>{steps[view]}</motion.div>
      </AnimatePresence>
    </section>
  );

  const phones = view === "home" && !cloudHome ? (
    <RowsCard label={t("settings.phone.linkedTitle")} action={<LinkAnother onClick={() => go("platform")} />}>
      {(devices ?? []).map((device) => (
        <ItemRow key={device.id} pixel="phone" title={device.name} hint={t("settings.mobile.seen", { when: lastSeen(device.lastSeenAt, now) })}>
          <span className={pill}>{t(platformLabelKey(device.platform))}</span>
          {device.relay && <span className={pill}>{t("settings.mobile.relay")}</span>}
          <button type="button" onClick={() => void remove(device.id)} disabled={removing !== null} aria-label={t("mobile.desktop.removePhone", { name: device.name })} className="ui-button mobile-press min-h-11 min-w-11 rounded-full">{t("settings.mobile.remove")}</button>
        </ItemRow>
      ))}
      {error && <p role="alert" className="m-0 px-2.5 py-2 text-[13px] leading-[18px] text-danger">{error}</p>}
    </RowsCard>
  ) : null;

  const parts: PhoneParts = { top, stepping: view !== "home", phones };
  return (
    <>
      <style>{`
        @keyframes phone-link-wait { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
        .phone-link-wait { animation: phone-link-wait 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .phone-link-wait { animation-play-state: paused; } }
        [data-reduced-motion="true"] .phone-link-wait { animation-play-state: paused; }
      `}</style>
      {children ? children(parts) : <div className="flex flex-col gap-5">{parts.top}{parts.phones}</div>}
    </>
  );
}

function LinkAnother({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" data-phone-link-another="" onClick={() => { haptic("selection"); onClick(); }} className="ui-button ui-button-pill mobile-press min-h-11">
      {t("mobile.desktop.linkAnother")}
    </button>
  );
}

/** One way to pair: its own tile with a small glyph, a lowercase name, and what it does. */
export function PairingTile({ id, icon, title, children, ...rest }: { id: string; icon: ReactNode; title: string; children: ReactNode; "data-pairing-tile"?: string }) {
  return (
    <section {...rest} aria-labelledby={id} className="flex min-w-0 flex-col gap-3 rounded-[12px] border-[0.5px] border-transparent bg-composer p-4">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink">{icon}</span>
        <h4 id={id} className="m-0 min-w-0 truncate text-[14px] font-medium leading-5 text-ink">{title}</h4>
      </div>
      {children}
    </section>
  );
}
