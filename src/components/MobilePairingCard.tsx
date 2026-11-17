import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Apple, ChevronLeft } from "../icons";
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
import { Card as RowsCard, ItemRow, reducedMotion, WIPE_MS } from "./ListRows";
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

/** the Android app is not on Google Play yet: its card is shown, not pickable */
export const ANDROID_APP_OUT = false;

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
  const [kind, setKind] = useState<PhoneKind>("ios");
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

  // every link starts at the phone picker, whatever was picked before
  const start = (): Flow => "platform";

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
    if (next === "android" && !ANDROID_APP_OUT) return;
    haptic("selection");
    setKind(next);
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

  const heading = (live: boolean, title: ReactNode, sub?: ReactNode, art?: PlaceArtName) => (
    <div className="flex flex-col items-center text-center">
      {art && <PlaceArt name={art} size={52} className="place-mark mb-4" />}
      <h3 id={live ? stepId : undefined} ref={live ? stepHeading : undefined} tabIndex={-1} className="m-0 text-balance text-[22px] font-normal leading-7 tracking-[-0.02em] text-ink outline-none">{title}</h3>
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
  // apple's badge, in the page's own ink: dark on a light skin, light on a dark one
  const appStoreBadge = (
    <a data-phone-app-store="" href={storeUrl("ios")} target="_blank" rel="noreferrer"
      className="inline-flex h-11 items-center gap-2 self-start rounded-[10px] bg-ink ps-3 pe-4 text-app transition-opacity duration-150 ease-[ease] hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
      <Apple size={20} aria-hidden="true" className="-mt-0.5" />
      <span className="flex flex-col items-start">
        <span className="text-[10px] leading-3 tracking-[0.01em]">{t("settings.phone.appStoreSmall")}</span>
        <span className="text-[16px] font-semibold leading-5 tracking-[-0.015em]">{t("settings.phone.appStoreBig")}</span>
      </span>
    </a>
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
    const off = !apple && !ANDROID_APP_OUT;
    return (
      <button type="button" data-phone-platform={option} aria-disabled={off || undefined} onClick={() => pick(option)}
        className={cn(off ? "cursor-default rounded-2xl bg-ink/[0.025] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" : TILE,
          "flex min-h-[176px] min-w-0 flex-col items-start justify-between gap-6 p-5 text-start")}>
        <span className="flex w-full items-start justify-between gap-2">
          <span className={cn("flex size-14 items-center justify-center", off && "opacity-50 grayscale")}><StoreMark name={apple ? "apple" : "android"} scale={2} /></span>
          {off && <span className={pill}>{t("settings.phone.androidTag")}</span>}
        </span>
        <span className={cn("flex flex-col gap-0.5", off && "opacity-60")}>
          <span className="text-[16px] font-medium leading-6 text-ink">{t(apple ? "settings.phone.iphone" : "settings.phone.android")}</span>
          <span className="text-[13px] leading-[18px] text-ink-secondary">{t(apple ? "settings.phone.iphoneSub" : "settings.phone.androidSub")}</span>
        </span>
      </button>
    );
  };

  const platformStep = (live: boolean) => (
    <div data-phone-choose="" className="flex flex-col items-center gap-6">
      {heading(live, t("settings.phone.whichTitle"), t(cloudHome ? "settings.phone.whichSubCloud" : "settings.phone.whichSub"))}
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">{phoneCard("ios")}{phoneCard("android")}</div>
    </div>
  );

  // one numbered step: a round number, what to do, and what it needs right under it
  const step = (n: number, title: ReactNode, children?: ReactNode) => (
    <li className="flex min-w-0 gap-3">
      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink/[0.07] text-[12px] font-medium leading-4 text-ink">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="text-[15px] font-medium leading-6 text-ink">{title}</span>
        {children}
      </div>
    </li>
  );
  const line = (text: ReactNode) => <span className="-mt-1 text-pretty text-[13px] leading-[18px] text-ink-secondary">{text}</span>;

  // the qr and its code in one column, the steps beside them where there is room, under them where there is not
  const linkGrid = (credentials: ReactNode, steps: ReactNode) => (
    <div className="@container w-full">
      <div data-phone-slab="" className="grid grid-cols-1 justify-items-center gap-8 @[500px]:grid-cols-[180px_minmax(0,1fr)] @[500px]:justify-items-stretch @[500px]:gap-10">
        <div className="flex w-[180px] flex-col items-center gap-3">{credentials}</div>
        <ol data-phone-steps={kind} className="m-0 flex w-full max-w-[400px] list-none flex-col gap-7 p-0 @[500px]:max-w-none">{steps}</ol>
      </div>
    </div>
  );

  const getApp = ios
    ? step(1, t("settings.phone.getIos"), appStoreBadge)
    : step(1, t("settings.phone.getAndroid"), line(t(cloudHome ? "settings.phone.getAndroidLineCloud" : "settings.phone.getAndroidLine")));

  // the typed code under the qr: its place is kept while it is made, so nothing moves when it lands
  const codeBlock = offer && !offer.code ? null : (
    <div className="flex w-full flex-col items-center">
      {offer && !expired ? (
        <code aria-label={t("settings.mobile.code")} data-phone-code="" className="select-all whitespace-nowrap font-mono text-[18px] leading-8 tracking-[0.06em] text-ink">{groupedCode}</code>
      ) : (
        <span aria-hidden="true" className={cn("my-1.5 block h-5 w-[140px] rounded-[6px] bg-ink/[0.06]", !expired && "animate-pulse motion-reduce:animate-none")} />
      )}
      <div className="flex items-center">
        <button type="button" data-phone-copy="" onClick={() => void copyCode()} disabled={!offer || expired} className={quietButton} aria-live="polite">
          {t(copied === "copied" ? "settings.mobile.copied" : copied === "failed" ? "settings.mobile.copyFailed" : "settings.mobile.copyCode")}
        </button>
        <button type="button" data-phone-new-code="" onClick={() => void create(true)} disabled={busy || !offer || expired} className={cn(quietButton, (!offer || expired) && "invisible")}>{t("settings.mobile.newCode")}</button>
      </div>
    </div>
  );
  const codeLine = (withCode: Parameters<typeof t>[0]) => line(t(offer && !offer.code ? "settings.mobile.scanOnly" : withCode));

  const failedBlock = (
    <div data-pairing-failed="" className="flex w-full flex-col items-center gap-3 rounded-[20px] bg-ink/[0.035] px-6 py-8 text-center">
      <PlaceArt name="error" size={44} />
      <p role="alert" className="m-0 max-w-[380px] text-pretty text-[14px] leading-5 text-ink-secondary">{error}</p>
      <button type="button" data-phone-new-code="" onClick={() => void create(true)} disabled={busy} className="ui-button ui-button-pill min-h-11">{t("settings.phone.tryAgain")}</button>
    </div>
  );

  const offerTile = (label: string) => expired ? ended("expired", t("settings.mobile.expired"), t("settings.mobile.newCode")) : qrTile(offer?.qr ?? null, label);

  const localLink = (live: boolean) => (
    <div data-phone-link="" className="flex flex-col items-center gap-8">
      {heading(live, t(ios ? "settings.phone.linkIos" : "settings.phone.linkAndroid"))}
      {failed ? failedBlock : linkGrid(<>{offerTile(t("settings.mobile.qr"))}{codeBlock}</>, <>
        {getApp}
        {step(2, t(ios ? "settings.phone.openIos" : "settings.phone.openAndroid"), codeLine(ios ? "settings.phone.openIosLine" : "settings.phone.openAndroidLine"))}
      </>)}
      {countdown && waiting(<>{t("mobile.desktop.waiting")} · {countdown}</>)}
    </div>
  );

  // a cloud from the desktop app: one qr and one letters-only code that log the phone in to the account, no email step
  const cloudCodeLink = (live: boolean) => (
    <div data-phone-cloud="" data-phone-cloud-code="" className="flex flex-col items-center gap-8">
      {heading(live, t(ios ? "settings.phone.cloudIos" : "settings.phone.cloudAndroid"),
        signInEmail && <span data-phone-cloud-as="" className="break-all">{t("settings.phone.cloudAs", { email: signInEmail })}</span>)}
      {failed ? failedBlock : linkGrid(<>{offerTile(t("settings.phone.cloudCodeQr"))}{codeBlock}</>, <>
        {getApp}
        {step(2, t(ios ? "settings.phone.openIos" : "settings.phone.openAndroid"), codeLine(ios ? "settings.phone.cloudCodeLine" : "settings.phone.cloudCodeLineAndroid"))}
      </>)}
      {countdown && waiting(<>{t("settings.phone.waitingCloud")} · {countdown}</>)}
    </div>
  );

  // a cloud in a browser tab or an older app: no code to make, the qr opens the app at its dusk cloud log in with the email filled in
  const cloudLink = (live: boolean) => codesInCloud ? cloudCodeLink(live) : (
    <div data-phone-cloud="" className="flex flex-col items-center gap-8">
      {heading(live, t(ios ? "settings.phone.cloudIos" : "settings.phone.cloudAndroid"))}
      {linkGrid(qrTile(universalSignInLink(signInEmail), t("settings.phone.cloudQr")), <>
        {getApp}
        {step(2, t("settings.phone.logInStep"), signInEmail ? (
          <div data-phone-cloud-sign-in="" className="-mt-1 flex min-w-0 flex-col gap-1">
            <span className="text-[12px] leading-4 text-ink-tertiary">{t("settings.phone.logInWith")}</span>
            <span className="max-w-full break-all text-[15px] font-medium leading-6 text-ink">{signInEmail}</span>
            <span className="text-pretty text-[13px] leading-[18px] text-ink-secondary">{t(ios ? "settings.phone.cloudScan" : "settings.phone.cloudScanAndroid")}</span>
          </div>
        ) : line(t("settings.phone.cloudScanAny")))}
      </>)}
      {waiting(t("settings.phone.waitingCloud"))}
    </div>
  );

  const doneStep = (live: boolean) => (
    <div role={live ? "status" : undefined} data-phone-linked="" className="flex flex-col items-center gap-6">
      {heading(live, cloudHome ? t("settings.phone.cloudLinked") : t("mobile.desktop.linked", { name: pairedName ?? "" }), t("mobile.desktop.linkedHint"), "connected")}
      <button type="button" data-primary="" onClick={() => go("home")} className={PRIMARY}>{t("common.done")}</button>
    </div>
  );

  const loadingStep = <div aria-hidden="true" className="h-[300px] animate-pulse rounded-[20px] bg-ink/[0.035] motion-reduce:animate-none" />;

  // one page of the flow, its own way back sliding with it
  const page = (at: string, live: boolean) => (
    <div className="mx-auto flex w-full max-w-[560px] flex-col gap-2 pb-2">
      {at === "link" ? <>{backBar("platform")}{(cloudHome ? cloudLink : localLink)(live)}</>
        : at === "platform" ? <>{backBar(hasPhones ? "home" : null)}{platformStep(live)}</>
        : at === "done" ? doneStep(live) : loadingStep}
    </div>
  );

  const top = view === "home" ? (cloudHome ? (
    <RowsCard label={t("settings.phone.linkedTitle")} action={<LinkAnother onClick={() => go(start())} />}>
      <ItemRow pixel="phone" title={t("settings.phone.cloudHome")} hint={signInEmail ? t("settings.phone.cloudHomeHint", { email: signInEmail }) : t("settings.phone.cloudHomeHintAny")} />
    </RowsCard>
  ) : null) : (
    <section aria-labelledby={stepId} data-phone-flow={view} className="flex w-full flex-col">
      {/* focus follows the swap onto the new page's heading */}
      <PhoneWipe at={view} layer={page} onSwap={() => requestAnimationFrame(() => { if (moved.current) stepHeading.current?.focus({ preventScroll: true }); })} />
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
        .phone-wipe { display: grid; }
        .phone-wipe[data-wiping] { overflow: clip; }
        .phone-wipe-layer { position: relative; z-index: 0; grid-area: 1 / 1; min-width: 0; background-color: var(--color-app); animation-duration: ${WIPE_MS}ms; animation-timing-function: var(--dusk-ease-out); }
        .phone-wipe-layer[data-wipe-out] { pointer-events: none; animation-fill-mode: forwards; }
        .phone-wipe-layer[data-wipe="push"]:not([data-wipe-out]) { z-index: 1; animation-name: dusk-wipe-push-in; }
        .phone-wipe-layer[data-wipe="push"][data-wipe-out] { animation-name: dusk-wipe-push-out; }
        .phone-wipe-layer[data-wipe="pop"]:not([data-wipe-out]) { animation-name: dusk-wipe-pop-in; }
        .phone-wipe-layer[data-wipe="pop"][data-wipe-out] { z-index: 1; animation-name: dusk-wipe-pop-out; }
        .phone-wipe-layer[data-wipe="fade"] { animation-duration: 150ms; }
        .phone-wipe-layer[data-wipe="fade"]:not([data-wipe-out]) { z-index: 1; background-color: transparent; animation-name: dusk-fade-in; }
        .phone-wipe-layer[data-wipe="fade"][data-wipe-out] { animation-name: dusk-fade-out; }
      `}</style>
      {children ? children(parts) : <div className="flex flex-col gap-5">{parts.top}{parts.phones}</div>}
    </>
  );
}

const PHONE_DEPTH: Partial<Record<string, number>> = { platform: 1, link: 2 };

/** The settings sub-page push (ListRows' WipeStack: 200ms, the app "out" curve) between the picker and a phone's link
 * page; any other change, or reduced motion, crossfades. Both pages share one grid cell while it runs, so the box keeps
 * the taller one's height and nothing below jumps. */
function PhoneWipe({ at, layer, onSwap }: { at: string; layer: (at: string, live: boolean) => ReactNode; onSwap: () => void }) {
  const [shown, setShown] = useState(at);
  const [wipe, setWipe] = useState<{ direction: "push" | "pop" | "fade"; from: string; id: number } | null>(null);
  if (at !== shown) {
    setShown(at);
    const from = PHONE_DEPTH[shown], to = PHONE_DEPTH[at];
    const slide = from !== undefined && to !== undefined && !reducedMotion();
    setWipe({ direction: slide ? (to > from ? "push" : "pop") : "fade", from: shown, id: (wipe?.id ?? 0) + 1 });
  }
  const swapped = useRef(onSwap);
  swapped.current = onSwap;
  useEffect(() => {
    if (!wipe) return;
    swapped.current();
    const timer = window.setTimeout(() => setWipe((current) => (current?.id === wipe.id ? null : current)), WIPE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [wipe]);
  return (
    <div className="phone-wipe" data-wiping={wipe ? "" : undefined}>
      <div className="phone-wipe-layer" data-wipe={wipe?.direction}>{layer(at, true)}</div>
      {wipe && (
        <div key={`out:${wipe.id}`} aria-hidden="true" inert className="phone-wipe-layer" data-wipe={wipe.direction} data-wipe-out=""
          onAnimationEnd={(event) => { if (event.target === event.currentTarget) setWipe((current) => (current?.id === wipe.id ? null : current)); }}>
          {layer(wipe.from, false)}
        </div>
      )}
    </div>
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
