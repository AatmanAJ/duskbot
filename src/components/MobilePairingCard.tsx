import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, KeyRound, QrCode } from "../icons";
import { PairingQr } from "./PairingQr";

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
import { Card as RowsCard, CopyRow, ItemRow, NoteRow } from "./ListRows";
import { PhoneHomeShot, StoreMarks } from "./PhoneHomeShot";
import { GROK_FOCUS } from "./SidebarSimpleTop";
import { friendlyError } from "@/lib/plain-error";

export function platformLabelKey(platform: string) {
  return platform === "ios" ? "settings.mobile.ios" : platform === "android" ? "settings.mobile.android" : "settings.mobile.phone";
}

export function newDeviceSince(before: readonly string[], after: readonly MobileDevice[]): MobileDevice | null {
  const known = new Set(before);
  return after.find((device) => !known.has(device.id)) ?? null;
}

const pill = "rounded-full bg-ink/5 px-2 py-0.5 text-[12px] leading-4 text-ink-secondary";
const quietButton = "mobile-press min-h-11 rounded-full px-3 text-[13px] font-medium text-ink-secondary hover:bg-ink/5 disabled:opacity-50";

/** The phone page's pieces, for a caller that lays them out around its own pairing code. */
export interface PhoneParts {
  /** the use case and the two ways to pair, or one way's own step once it is picked */
  top: ReactNode;
  /** a way's step is open: the caller keeps its own extras out of the way */
  stepping: boolean;
  phones: ReactNode;
}

type Way = "qr" | "code";

export function MobilePairingCard({ remote, children }: {
  remote: boolean;
  /** lays the pieces out; null when this workspace may not link phones */
  children?: (phone: PhoneParts | null) => ReactNode;
}) {
  const [devices, setDevices] = useState<MobileDevice[] | null>(null);
  const [offer, setOffer] = useState<MobilePairingResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const [view, setView] = useState<Way | null>(null);
  const viewRef = useRef<Way | null>(null);
  viewRef.current = view;
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const [pairedName, setPairedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const generation = useRef(0);
  const baseline = useRef<string[] | null>(null);
  const linkId = useId();
  const stepId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Way | null>(null);
  const tiles = useRef<Record<Way, HTMLButtonElement | null>>({ qr: null, code: null });
  const reducedMotion = useReducedMotion();

  const loadDevices = useCallback(async (epoch: number) => {
    try {
      const body = await api<{ devices: MobileDevice[]; current: string | null }>("/api/mobile/devices");
      if (generation.current !== epoch) return;
      setDevices(body.devices);
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
        haptic("error");
      }
    }
  }, []);

  useEffect(() => {
    const epoch = ++generation.current;
    baseline.current = null;
    setDevices(null);
    setOffer(null);
    setHidden(false);
    setBusy(false);
    setRemoving(null);
    setPairedName(null);
    setShowLink(false);
    setView(null);
    setError(null);
    void loadDevices(epoch);
    return () => { generation.current += 1; };
  }, [loadDevices, remote]);

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

  /** Opens a way's own step; a live offer is reused, since it carries both the qr's link and the typed code. */
  async function create(way: Way, fresh = false) {
    if (busy || !devices) return;
    opener.current = way;
    setView(way);
    setCopied("idle");
    if (!fresh && offer && offer.expiresAt > Date.now() && pairedName === null) return;
    const epoch = generation.current;
    setBusy(true);
    setError(null);
    setShowLink(false);
    setPairedName(null);
    setOffer(null);
    baseline.current = null;
    try {
      if (!(await requireUserPresence()) || generation.current !== epoch) return;
      const request: MobilePairingRequest = {};
      const companion = remote ? null : companionBridge();
      if (companion) {
        try {
          request.companion = (await companion.start()).endpoints;
        } catch {}
      }
      if (generation.current !== epoch) return;
      const body = await api<MobilePairingResponse>("/api/mobile/pairing", { method: "POST", body: JSON.stringify(request) });
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
  const state = pairedName !== null ? "success" : offer ? (expired ? "expired" : "offer") : "idle";
  const groupedCode = offer?.code?.replace(/[^a-z0-9]/gi, "").match(/.{1,4}/g)?.join(" ");

  const motionProps = {
    initial: { opacity: 0, y: reducedMotion ? 0 : 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: reducedMotion ? 0 : -4 },
    transition: { duration: reducedMotion ? 0 : dur.base, ease: ease.out },
  };

  // the use case first: the phone app's own home, big, with one plain line beside it
  const hero = (
    <div data-phone-hero="" className="@container">
      <div className="grid overflow-hidden rounded-[16px] border-[0.5px] border-transparent bg-composer @min-[460px]:grid-cols-[1fr_auto]">
        <div className="flex flex-col justify-center gap-2 px-6 pb-2 pt-6 @min-[460px]:py-8">
          <h3 className="m-0 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-ink">{t("mobile.desktop.title")}</h3>
          <p className="m-0 text-[14px] leading-5 text-ink-secondary">{t("mobile.desktop.oneLine")}</p>
          <p data-phone-platforms="" className="m-0 mt-2 flex items-center gap-2 text-[12px] leading-4 text-ink-tertiary"><StoreMarks />{t("mobile.desktop.storesSoon")}</p>
        </div>
        <div className="flex h-[280px] justify-center overflow-hidden px-8 pt-6 @min-[460px]:h-[300px]">
          <PhoneHomeShot size="large" />
        </div>
      </div>
    </div>
  );

  const tile = (way: Way) => {
    const qr = way === "qr";
    return (
      <button type="button" ref={(node) => { tiles.current[way] = node; }} data-pairing-tile={way} {...(qr ? { "data-phone-pair": "" } : { "data-phone-code": "" })}
        onClick={() => { haptic("selection"); void create(way); }} disabled={devices === null}
        className={cn("mobile-press flex min-h-[72px] w-full items-center gap-3 rounded-[12px] border-[0.5px] border-transparent bg-composer px-4 py-3.5 text-start transition-colors duration-150 ease-out hover:bg-ink/[0.03] disabled:opacity-60", GROK_FOCUS)}>
        <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink">{qr ? <QrCode size={18} /> : <KeyRound size={18} />}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[14px] font-medium leading-5 text-ink">{t(qr ? "settings.mobile.scanTitle" : "settings.w6.pairing.title")}</span>
          <span className="text-[13px] leading-[18px] text-ink-secondary">{t(qr ? "settings.mobile.scanLine" : "settings.mobile.codeLine")}</span>
        </span>
        <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ink-tertiary" />
      </button>
    );
  };

  const overview = (
    <div className="flex flex-col gap-5">
      {hero}
      <div className="@container">
        <div data-pairing-ways="" className="grid gap-3 @min-[480px]:grid-cols-2">{tile("qr")}{tile("code")}</div>
      </div>
      {error && <p role="alert" className="m-0 px-3 text-[13px] leading-[18px] text-danger">{error}</p>}
    </div>
  );

  // one way at a time: only its qr or its code, one instruction, back and a new code
  const qrStep = view === "qr";
  const step = view && (
    <section aria-labelledby={stepId} data-pairing-step={view} className="flex flex-col items-center gap-5 rounded-[16px] border-[0.5px] border-transparent bg-composer px-6 pb-7 pt-3 text-center">
      <div className="flex w-full justify-start">
        <button type="button" data-pairing-back="" onClick={() => setView(null)} className={cn("mobile-press -ms-3 flex min-h-11 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-ink-secondary hover:bg-ink/5", GROK_FOCUS)}>
          <ChevronLeft aria-hidden="true" size={16} />{t("common.back")}
        </button>
      </div>
      <h3 id={stepId} ref={stepHeading} tabIndex={-1} className="m-0 text-[17px] font-semibold leading-6 text-ink outline-none">{t(qrStep ? "settings.mobile.scanTitle" : "settings.w6.pairing.title")}</h3>
      {state === "success" ? (
        <div role="status" className="flex flex-col items-center gap-3">
          <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success"><Check size={24} /></span>
          <p className="m-0 break-words text-[14px] font-medium leading-5 text-ink">{t("mobile.desktop.linked", { name: pairedName ?? "" })}</p>
          <p className="m-0 text-[13px] leading-[18px] text-ink-secondary">{t("mobile.desktop.linkedHint")}</p>
          <button type="button" onClick={() => setView(null)} className="ui-button mobile-press mt-2 min-h-11 rounded-full">{t("common.done")}</button>
        </div>
      ) : state === "expired" ? (
        <div className="flex flex-col items-center gap-3">
          <p role="status" className="m-0 text-[13px] leading-[18px] text-ink-secondary">{t("settings.mobile.expired")}</p>
          <button type="button" onClick={() => void create(view, true)} disabled={busy} className="ui-button mobile-press min-h-11 rounded-full">{t("settings.mobile.newCode")}</button>
        </div>
      ) : (
        <>
          {qrStep ? (
            <div role="img" aria-label={t("settings.mobile.qr")} aria-busy={!offer} className="flex size-[232px] items-center justify-center rounded-[16px] bg-white p-3">
              {offer ? <PairingQr value={offer.link} size={208} level="M" includeMargin={false} bgColor="#ffffff" fgColor="#1b1b1f" aria-hidden="true" />
                : <span className="size-[208px] animate-pulse rounded-[8px] bg-[#1b1b1f]/[0.06] motion-reduce:animate-none" />}
            </div>
          ) : offer && offer.code === null ? (
            <p className="m-0 max-w-[320px] text-[13px] leading-[18px] text-ink-secondary">{t("settings.mobile.scanOnly")}</p>
          ) : (
            <div className="flex min-h-12 items-center justify-center">
              {offer ? <code aria-label={t("settings.mobile.code")} className="select-all whitespace-nowrap font-mono text-[30px] leading-10 tracking-[0.12em] text-ink">{groupedCode}</code>
                : <span aria-hidden="true" className="h-10 w-[260px] animate-pulse rounded-[8px] bg-ink/[0.06] motion-reduce:animate-none" />}
            </div>
          )}
          {!(offer && !qrStep && offer.code === null) && (
            <p className="m-0 max-w-[340px] text-[14px] leading-5 text-ink-secondary">{t(qrStep ? "settings.mobile.scanSteps" : "settings.docs.phone.codeSteps")}</p>
          )}
          {offer && (
            <p role="status" className="m-0 flex items-center gap-2 text-[13px] leading-[18px] text-ink-tertiary">
              <span aria-hidden="true" className="phone-link-wait inline-block size-1.5 rounded-full bg-ink-secondary" />
              {t("mobile.desktop.waiting")} · {t("settings.mobile.expires", { minutes: minutesLeft(offer.expiresAt, now) })}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-1">
            <button type="button" data-phone-new-code="" onClick={() => void create(view, true)} disabled={busy} className={quietButton}>{t("settings.mobile.newCode")}</button>
            {qrStep ? (offer && (
              <button type="button" aria-expanded={showLink} aria-controls={linkId} onClick={() => { setShowLink(!showLink); haptic("selection"); }} className={quietButton}>
                {t("mobile.desktop.copyLinkInstead")}
              </button>
            )) : offer?.code ? (
              <button type="button" onClick={() => void copyCode()} className={quietButton} aria-live="polite">
                {t(copied === "copied" ? "settings.mobile.copied" : copied === "failed" ? "settings.mobile.copyFailed" : "settings.mobile.copyCode")}
              </button>
            ) : null}
          </div>
          {qrStep && offer && (
            <div id={linkId} hidden={!showLink} className="w-full max-w-[420px] text-start [&_button]:min-h-11 [&_button]:min-w-11">
              {showLink && <CopyRow title={t("settings.mobile.link")} text={offer.link} copyLabel={t("settings.mobile.copyLink")} />}
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="m-0 text-[13px] leading-[18px] text-danger">{error}</p>}
    </section>
  );

  const top = (
    // focus follows the swap once the old view has left: into a step, then back to the tile that opened it
    <AnimatePresence mode="wait" initial={false} onExitComplete={() => requestAnimationFrame(() => {
      if (viewRef.current) stepHeading.current?.focus({ preventScroll: true });
      else if (opener.current) { tiles.current[opener.current]?.focus({ preventScroll: true }); opener.current = null; }
    })}>
      <motion.div key={view ?? "overview"} {...motionProps}>{step || overview}</motion.div>
    </AnimatePresence>
  );

  const phones = (
    <RowsCard label={t("settings.mobile.devices")}>
      {devices?.length ? devices.map((device) => (
        <ItemRow key={device.id} pixel="phone" title={device.name} hint={t("settings.mobile.seen", { when: lastSeen(device.lastSeenAt, now) })}>
          <span className={pill}>{t(platformLabelKey(device.platform))}</span>
          {device.relay && <span className={pill}>{t("settings.mobile.relay")}</span>}
          <button type="button" onClick={() => void remove(device.id)} disabled={removing !== null} aria-label={t("mobile.desktop.removePhone", { name: device.name })} className="ui-button mobile-press min-h-11 min-w-11 rounded-full">{t("settings.mobile.remove")}</button>
        </ItemRow>
      )) : <NoteRow>{t("settings.mobile.empty")}</NoteRow>}
    </RowsCard>
  );

  const parts: PhoneParts = { top, stepping: view !== null, phones };
  return (
    <>
      <style>{`
        @keyframes phone-link-wait { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
        .phone-link-wait { animation: phone-link-wait 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .phone-link-wait { animation-play-state: paused; } }
        [data-reduced-motion="true"] .phone-link-wait { animation-play-state: paused; }
      `}</style>
      {children ? children(parts) : <div className="flex flex-col gap-5">{top}{phones}</div>}
    </>
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
