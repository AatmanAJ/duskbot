import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft } from "../icons";
import { QRCodeSVG } from "qrcode.react";

import { universalPairLink, universalSignInLink, type MobileDevice, type MobilePairingRequest, type MobilePairingResponse } from "../../shared/mobile-link";
import type { CloudPlanBridge } from "../../electron/cloud-account.mjs";
import { companionBridge } from "@/lib/companion-bridge";
import { copyText, type CopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { requireUserPresence } from "@/lib/user-presence";
import { api, ApiError } from "@/state/store";
import { lastSeen, minutesLeft } from "../lib/pairing-time";
import { haptic } from "../mobile/haptics";
import { dur, ease } from "../mobile/motion";
import { Card as RowsCard, ItemRow } from "./ListRows";
import { PlaceArt, type PlaceArtName } from "./ui/PlaceArt";
import { StoreMark } from "./ui/StoreMarks";
import { PRIMARY, QUIET, TILE } from "./onboarding/FunnelSteps";
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
  /** the link screen, or the short header over the linked phones once one is in */
  top: ReactNode;
  /** the link screen is up: the caller keeps its own extras out of the way */
  stepping: boolean;
  phones: ReactNode;
}

type Flow = "loading" | "home" | "platform" | "link";
export type PhoneKind = "ios" | "android";

/** the phone picked last time: the next link starts at its steps, with a way back to pick again */
export const PHONE_KIND_KEY = "dusk.settings.phoneKind";
export function rememberedPhone(): PhoneKind | null {
  try {
    const kind = window.localStorage.getItem(PHONE_KIND_KEY);
    return kind === "ios" || kind === "android" ? kind : null;
  } catch { return null; }
}

/** a live code is swapped for a new one this long before it ends, so the screen never shows a dead code */
export const RENEW_BEFORE_MS = 60_000;
/** silent swaps after the one the person asked for: about an hour with the screen open, then it ends and says so */
export const AUTO_RENEWALS = 5;

/** what the link screen shows: the qr's link, the typed code, and for a dusk cloud the account the code logs into */
type Offer = { qr: string; code: string | null; expiresAt: number; email?: string };

/** a dusk cloud's phone sign-in codes come from the desktop app's own account sign-in; a browser tab or an older app has none */
function cloudCodeBridge(cloudHome: boolean): Required<Pick<CloudPlanBridge, "phoneSignIn">> | null {
  if (!cloudHome || typeof window === "undefined") return null;
  const bridge = window.duskDesktop?.cloudPlan;
  return typeof bridge?.phoneSignIn === "function" ? { phoneSignIn: bridge.phoneSignIn.bind(bridge) } : null;
}

export function MobilePairingCard({ remote, cloudHome = false, email, children }: {
  remote: boolean;
  /** a dusk cloud refuses phone codes (server/index.ts createMobileLink refusal): the iPhone app reaches it by signing in */
  cloudHome?: boolean;
  /** the account's email, filled in on the phone's sign-in */
  email?: string;
  /** lays the pieces out; null when this workspace may not link phones */
  children?: (phone: PhoneParts | null) => ReactNode;
}) {
  const [devices, setDevices] = useState<MobileDevice[] | null>(null);
  const [cloudSignIns, setCloudSignIns] = useState<PairedDevice[] | null>(null);
  const signInsSeen = useRef(cloudSignIns);
  signInsSeen.current = cloudSignIns;
  const [offer, setOffer] = useState<Offer | null>(null);
  const cloudCodes = cloudCodeBridge(cloudHome);
  const codesInCloud = cloudCodes !== null;
  // the account's email, once a code named it: kept for the linked phones row after the code is gone
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow>("loading");
  const [kind, setKind] = useState<PhoneKind>(() => rememberedPhone() ?? "ios");
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
  const stepId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const reducedMotion = useReducedMotion();

  const start = (): Flow => rememberedPhone() ? "link" : "platform";

  const loadDevices = useCallback(async (epoch: number) => {
    try {
      const body = await api<{ devices: MobileDevice[]; current: string | null }>("/api/mobile/devices");
      if (generation.current !== epoch) return;
      setDevices(body.devices);
      if (!cloudHome) setFlow((at) => at === "loading" ? (body.devices.length ? "home" : start()) : at);
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
        if (!cloudHome) setFlow((at) => at === "loading" ? start() : at);
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
      setFlow((at) => at === "loading" ? (phones.length ? "home" : start()) : at);
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
      if (generation.current === epoch) setFlow((at) => at === "loading" ? start() : at);
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
    setFlow("loading");
    setError(null);
    moved.current = false;
    void loadDevices(epoch);
    if (cloudHome) void loadCloudSignIns(epoch);
    return () => { generation.current += 1; };
  }, [loadDevices, loadCloudSignIns, remote, cloudHome]);

  // the link screen makes its code as soon as it is up, the first time included
  useEffect(() => {
    if (flow === "link" && (codesInCloud || (!cloudHome && devices)) && !offer && !busy && pairedName === null && error === null) void create();
  }, [flow, cloudHome, codesInCloud, devices]);

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
    // a cloud's phone shows up with its sign-ins, watched below
    if (!cloudHome) timer = setTimeout(() => void poll(), 2_000);
    return () => { cancelled = true; clearTimeout(timer); clearInterval(clock); };
  }, [loadDevices, offer, cloudHome]);

  // on a cloud's link screen, watch for the phone's own sign-in
  useEffect(() => {
    if (!cloudHome || flow !== "link" || pairedName !== null) return;
    const epoch = generation.current;
    cloudBaseline.current = (signInsSeen.current ?? []).map((session) => session.id);
    const poll = setInterval(() => void loadCloudSignIns(epoch), 3_000);
    return () => { clearInterval(poll); cloudBaseline.current = null; };
  }, [cloudHome, flow, pairedName, loadCloudSignIns]);

  // while the screen is up, a code is replaced before it ends; the old one keeps working until its own end
  useEffect(() => {
    if (!offer || flow !== "link" || pairedName !== null || renewals.current >= AUTO_RENEWALS) return;
    const epoch = generation.current;
    const timer = setTimeout(() => {
      renewals.current += 1;
      void mint(true).then((body) => {
        if (body && generation.current === epoch && linking.current) { setOffer(body); setNow(Date.now()); setCopied("idle"); }
      }).catch(() => {});
    }, Math.max(0, offer.expiresAt - RENEW_BEFORE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [offer, flow, pairedName]);

  /** One offer carries both the qr's link and the typed code; a live one is reused. */
  async function create(fresh = false) {
    if (busy || (!codesInCloud && !devices)) return;
    setCopied("idle");
    if (!fresh && offer && offer.expiresAt > Date.now() && pairedName === null) return;
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    setPairedName(null);
    setOffer(null);
    baseline.current = null;
    renewals.current = 0;
    try {
      // a cloud's code is checked in the desktop app itself, before it is made
      if ((!codesInCloud && !(await requireUserPresence())) || generation.current !== epoch) return;
      const body = await mint(false);
      if (!body || generation.current !== epoch) return;
      if (!codesInCloud) baseline.current = (devices ?? []).map((device) => device.id);
      setOffer(body);
      setNow(Date.now());
    } catch (cause) {
      if (generation.current === epoch) {
        setError(friendlyError(cause, t("settings.mobile.error")));
        haptic("error");
      }
    } finally {
      if (generation.current === epoch) setBusy(false);
    }
  }

  /** null: the person did not confirm it was them, so nothing is shown and nothing is said */
  async function mint(renew: boolean): Promise<Offer | null> {
    if (cloudCodes) {
      const result = await cloudCodes.phoneSignIn(renew);
      if (result.outcome === "code") {
        setAccountEmail(result.email);
        return { qr: universalSignInLink(result.email, result.code), code: result.code, expiresAt: result.expiresAt, email: result.email };
      }
      if (result.outcome === "canceled") return null;
      throw new Error(t(result.outcome === "signed-out" ? "settings.phone.cloudSignedOut" : result.outcome === "limited" ? "settings.phone.cloudLimited" : "settings.mobile.error"));
    }
    const request: MobilePairingRequest = {};
    const companion = remote ? null : companionBridge();
    if (companion) {
      try {
        request.companion = (await companion.start()).endpoints;
      } catch {}
    }
    const body = await api<MobilePairingResponse>("/api/mobile/pairing", { method: "POST", body: JSON.stringify(request) });
    return { qr: universalPairLink(body.link, body.code), code: body.code, expiresAt: body.expiresAt };
  }

  function pick(next: PhoneKind) {
    haptic("selection");
    setKind(next);
    try { window.localStorage.setItem(PHONE_KIND_KEY, next); } catch {}
    go("link");
  }

  function go(to: Flow) {
    moved.current = true;
    setError(null);
    setPairedName(null);
    if (to === "home") setOffer(null);
    setFlow(to);
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
  const signInEmail = offer?.email ?? accountEmail ?? (email?.trim() || undefined);
  const failed = error !== null && offer === null && !busy;

  const motionProps = {
    initial: { opacity: 0, y: reducedMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reducedMotion ? 0 : -4 },
    transition: { duration: reducedMotion ? 0.12 : dur.base, ease: ease.out },
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

  // the qr's white tile, the same size whatever it holds, so nothing jumps while a code is made or renewed. level L: a
  // screen does not smudge, and the long link gets bigger modules that a camera reads from further away
  const qrTile = (value: string | null, label: string) => (
    <div role="img" aria-label={label} aria-busy={!value} data-phone-qr={value ?? ""} className="flex size-[180px] shrink-0 items-center justify-center rounded-[14px] bg-white p-2.5">
      {value ? <QRCodeSVG value={value} size={160} level="L" includeMargin={false} bgColor="#ffffff" fgColor="#1b1b1f" aria-hidden="true" />
        : <span className="size-[160px] animate-pulse rounded-[8px] bg-[#1b1b1f]/[0.06] motion-reduce:animate-none" />}
    </div>
  );

  const ended = (art: PlaceArtName, line: string, action: string) => (
    <div className="flex size-[180px] shrink-0 flex-col items-center justify-center gap-3 rounded-[14px] bg-ink/[0.04] p-3 text-center">
      <PlaceArt name={art} size={40} />
      <p role="status" className="m-0 text-[13px] leading-[18px] text-ink-secondary">{line}</p>
      <button type="button" data-phone-new-code="" onClick={() => void create(true)} disabled={busy} className="ui-button ui-button-pill min-h-11">{action}</button>
    </div>
  );

  const ios = kind === "ios";
  const storeBadge = ios ? (
    <a data-phone-app-store="" href={storeUrl("ios")} target="_blank" rel="noreferrer" aria-label={t("settings.phone.appStoreLabel")}
      className="inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-ink/[0.05] py-1.5 pe-3.5 ps-2.5 text-[13px] font-medium leading-[18px] text-ink transition-colors duration-150 ease-[ease] hover:bg-ink/[0.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
      <StoreMark name="apple" />{t("settings.phone.iphoneTag")}
    </a>
  ) : (
    <span data-phone-google-play="" className="inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-ink/[0.035] py-1.5 pe-2 ps-2.5 text-[13px] leading-[18px] text-ink-secondary">
      <StoreMark name="android" />{t("settings.phone.googlePlay")}<span className={pill}>{t("settings.phone.androidTag")}</span>
    </span>
  );

  const backBar = (to: Flow | null) => to && (
    <div className="flex h-11 items-center">
      <button type="button" data-pairing-back="" onClick={() => go(to)}
        className="inline-flex min-h-11 items-center gap-0.5 rounded-full py-1 pe-3 ps-1.5 text-[13px] leading-[18px] text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
        <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" className="rtl:-scale-x-100" />{t(to === "platform" ? "settings.phone.otherPhone" : "common.back")}
      </button>
    </div>
  );

  const countdown = offer && !expired && (renewals.current < AUTO_RENEWALS
    ? t("settings.mobile.renews", { minutes: minutesLeft(offer.expiresAt - RENEW_BEFORE_MS, now) })
    : t("settings.mobile.expires", { minutes: minutesLeft(offer.expiresAt, now) }));

  const phoneCard = (option: PhoneKind) => {
    const apple = option === "ios";
    return (
      <button type="button" data-phone-platform={option} aria-pressed={rememberedPhone() === option} onClick={() => pick(option)}
        className={cn(TILE, "flex min-h-[176px] min-w-0 flex-col items-start justify-between gap-6 p-5 text-start")}>
        <span className="flex w-full items-start justify-between gap-2">
          <span className="flex size-14 items-center justify-center"><StoreMark name={apple ? "apple" : "android"} scale={2} /></span>
          <span className={pill}>{t(apple ? "settings.phone.iphoneTag" : "settings.phone.androidTag")}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[16px] font-medium leading-6 text-ink">{t(apple ? "settings.phone.iphone" : "settings.phone.android")}</span>
          <span className="text-[13px] leading-[18px] text-ink-secondary">{t(apple ? "settings.phone.iphoneSub" : "settings.phone.androidSub")}</span>
        </span>
      </button>
    );
  };

  const platformStep = (
    <div data-phone-choose="" className="flex flex-col items-center gap-6">
      {heading(t("settings.phone.whichTitle"), t(cloudHome ? "settings.phone.whichSubCloud" : "settings.phone.whichSub"))}
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">{phoneCard("ios")}{phoneCard("android")}</div>
    </div>
  );

  // one numbered step: a round number, what to do, and what it needs right under it
  const step = (n: number, title: ReactNode, children: ReactNode) => (
    <li className="flex min-w-0 gap-3.5">
      <span aria-hidden="true" className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-ink/[0.07] text-[12px] font-medium leading-4 text-ink">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[15px] font-medium leading-6 text-ink">{title}</span>
        {children}
      </div>
    </li>
  );
  const line = (text: ReactNode) => <span className="text-pretty text-[13px] leading-[18px] text-ink-secondary">{text}</span>;

  // the qr beside the two steps where there is room, above them where there is not
  const slab = (left: ReactNode, steps: ReactNode) => (
    <div className="@container w-full">
      <div data-phone-slab="" className="grid grid-cols-1 gap-6 rounded-[20px] bg-ink/[0.035] p-5 @[500px]:grid-cols-[auto_minmax(0,1fr)] @[500px]:items-start @[500px]:gap-7">
        <div className="flex flex-col items-center gap-2 justify-self-center">
          {left}
          <span className="text-[12px] leading-4 text-ink-tertiary">{t(ios ? "settings.phone.qrCaption" : "settings.phone.qrCaptionAndroid")}</span>
        </div>
        <ol data-phone-steps={kind} className="m-0 flex list-none flex-col gap-6 p-0 @[500px]:pt-1">{steps}</ol>
      </div>
    </div>
  );

  const getApp = ios
    ? step(1, t("settings.phone.getIos"), <>{line(t("settings.phone.getIosLine"))}{storeBadge}</>)
    : step(1, t("settings.phone.getAndroid"), <>{line(t(cloudHome ? "settings.phone.getAndroidLineCloud" : "settings.phone.getAndroidLine"))}{storeBadge}</>);

  const codeBlock = offer && !offer.code ? line(t("settings.mobile.scanOnly")) : (
    <div className="flex flex-col items-start gap-1">
      {offer && !expired ? (
        <code aria-label={t("settings.mobile.code")} data-phone-code="" className="select-all whitespace-nowrap font-mono text-[26px] leading-9 tracking-[0.08em] text-ink">{groupedCode}</code>
      ) : (
        <span aria-hidden="true" className={cn("my-0.5 block h-8 w-[220px] max-w-full rounded-[8px] bg-ink/[0.06]", !expired && "animate-pulse motion-reduce:animate-none")} />
      )}
      <div className="-ms-3 flex flex-wrap items-center gap-1">
        <button type="button" data-phone-copy="" onClick={() => void copyCode()} disabled={!offer || expired} className={quietButton} aria-live="polite">
          {t(copied === "copied" ? "settings.mobile.copied" : copied === "failed" ? "settings.mobile.copyFailed" : "settings.mobile.copyCode")}
        </button>
        {offer && !expired && <button type="button" data-phone-new-code="" onClick={() => void create(true)} disabled={busy} className={quietButton}>{t("settings.mobile.newCode")}</button>}
      </div>
    </div>
  );

  const failedBlock = (
    <div data-pairing-failed="" className="flex w-full flex-col items-center gap-3 rounded-[20px] bg-ink/[0.035] px-6 py-8 text-center">
      <PlaceArt name="error" size={44} />
      <p role="alert" className="m-0 max-w-[380px] text-pretty text-[14px] leading-5 text-ink-secondary">{error}</p>
      <button type="button" data-phone-new-code="" onClick={() => void create(true)} disabled={busy} className="ui-button ui-button-pill min-h-11">{t("settings.phone.tryAgain")}</button>
    </div>
  );

  const localLink = (
    <div data-phone-link="" className="flex flex-col items-center gap-6">
      {heading(t(ios ? "settings.phone.linkIos" : "settings.phone.linkAndroid"))}
      {failed ? failedBlock : slab(
        expired ? ended("expired", t("settings.mobile.expired"), t("settings.mobile.newCode"))
          : qrTile(offer?.qr ?? null, t("settings.mobile.qr")),
        <>
          {getApp}
          {step(2, t(ios ? "settings.phone.openIos" : "settings.phone.openAndroid"), <>{line(t(ios ? "settings.phone.openIosLine" : "settings.phone.openAndroidLine"))}{codeBlock}</>)}
        </>,
      )}
      {countdown && waiting(<>{t("mobile.desktop.waiting")} · {countdown}</>)}
    </div>
  );

  // a cloud from the desktop app: one qr and one letters-only code that log the phone in to the account, no email step
  const cloudCodeLink = (
    <div data-phone-cloud="" data-phone-cloud-code="" className="flex flex-col items-center gap-6">
      {heading(t(ios ? "settings.phone.cloudIos" : "settings.phone.cloudAndroid"))}
      {failed ? failedBlock : slab(
        expired ? ended("expired", t("settings.mobile.expired"), t("settings.mobile.newCode"))
          : qrTile(offer?.qr ?? null, t("settings.phone.cloudCodeQr")),
        <>
          {getApp}
          {step(2, t(ios ? "settings.phone.openIos" : "settings.phone.openAndroid"), <>
            {line(t(ios ? "settings.phone.cloudCodeLine" : "settings.phone.cloudCodeLineAndroid"))}
            {codeBlock}
            {signInEmail && <span data-phone-cloud-as="" className="max-w-full break-all text-[12px] leading-4 text-ink-tertiary">{t("settings.phone.cloudAs", { email: signInEmail })}</span>}
          </>)}
        </>,
      )}
      {countdown && waiting(<>{t("settings.phone.waitingCloud")} · {countdown}</>)}
    </div>
  );

  // a cloud in a browser tab or an older app: no code to make, the qr opens the app at its dusk cloud log in with the email filled in
  const cloudLink = codesInCloud ? cloudCodeLink : (
    <div data-phone-cloud="" className="flex flex-col items-center gap-6">
      {heading(t(ios ? "settings.phone.cloudIos" : "settings.phone.cloudAndroid"))}
      {slab(
        qrTile(universalSignInLink(signInEmail), t("settings.phone.cloudQr")),
        <>
          {getApp}
          {step(2, t("settings.phone.logInStep"), signInEmail ? (
            <div data-phone-cloud-sign-in="" className="flex min-w-0 flex-col gap-1">
              <span className="text-[12px] leading-4 text-ink-tertiary">{t("settings.phone.logInWith")}</span>
              <span className="max-w-full break-all text-[18px] font-medium leading-6 text-ink">{signInEmail}</span>
              {line(t(ios ? "settings.phone.cloudScan" : "settings.phone.cloudScanAndroid"))}
            </div>
          ) : line(t("settings.phone.cloudScanAny")))}
        </>,
      )}
      {waiting(t("settings.phone.waitingCloud"))}
    </div>
  );

  const doneStep = (
    <div role="status" data-phone-linked="" className="flex flex-col items-center gap-6">
      {heading(cloudHome ? t("settings.phone.cloudLinked") : t("mobile.desktop.linked", { name: pairedName ?? "" }), t("mobile.desktop.linkedHint"), "connected")}
      <button type="button" data-primary="" onClick={() => go("home")} className={PRIMARY}>{t("common.done")}</button>
    </div>
  );

  const loadingStep = <div aria-hidden="true" className="h-[300px] animate-pulse rounded-[20px] bg-ink/[0.035] motion-reduce:animate-none" />;

  const steps: Record<Exclude<typeof view, "home">, ReactNode> = { loading: loadingStep, platform: platformStep, link: cloudHome ? cloudLink : localLink, done: doneStep };

  const top = view === "home" ? (cloudHome ? (
    <RowsCard label={t("settings.phone.linkedTitle")} action={<LinkAnother onClick={() => go(start())} />}>
      <ItemRow pixel="phone" title={t("settings.phone.cloudHome")} hint={signInEmail ? t("settings.phone.cloudHomeHint", { email: signInEmail }) : t("settings.phone.cloudHomeHintAny")} />
    </RowsCard>
  ) : null) : (
    <section aria-labelledby={stepId} data-phone-flow={view} className="mx-auto flex w-full max-w-[560px] flex-col gap-2 pb-2">
      {view === "link" ? backBar("platform") : view === "platform" ? backBar(hasPhones ? "home" : null) : null}
      {/* focus follows the swap once the old view has left */}
      <AnimatePresence mode="wait" initial={false} onExitComplete={() => requestAnimationFrame(() => { if (moved.current) stepHeading.current?.focus({ preventScroll: true }); })}>
        <motion.div key={view} {...motionProps}>{steps[view]}</motion.div>
      </AnimatePresence>
    </section>
  );

  const phones = view === "home" && !cloudHome ? (
    <RowsCard label={t("settings.phone.linkedTitle")} action={<LinkAnother onClick={() => go(start())} />}>
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
