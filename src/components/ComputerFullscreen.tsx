import { useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Loader2, RotateCw } from "../icons";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { reducedMotion } from "@/lib/onboarding";
import { PlatformContext, type MobilePlatform } from "@/mobile/platform";
import { useCaptionChrome, useDesktopCapabilities } from "./DesktopCapabilities";
import { Icon } from "./Icon";
import { useDialogKeys } from "./ui/GrokDialog";
import "./computer-fullscreen.css";

/** The pill under the screen, as grok's control bar: watching with Take control; in control with I'm done when the bot
 * asked for the person's hands (`asked`), else Stop. A screen that can only be watched shows the status alone. */
export type ScreenControl =
  | { held: false; onTake?: () => void; busy?: boolean; /** Take control is on its way: a spinner holds the label's place. */ pending?: boolean }
  | { held: true; onDone: () => void; asked?: boolean; busy?: boolean };

// grok's control row under the frame
const BAR = 52;
// grok's computer-watch-hint: how long a click on a watched screen keeps pointing at Take control
export const WATCH_HINT_MS = 2500;

/** A click on a screen being watched pulses Take control and says so to screen readers, until WATCH_HINT_MS after the
 * last click. */
function useWatchHint(active: boolean) {
  const [hint, setHint] = useState<{ count: number; shown: boolean }>({ count: 0, shown: false });
  useEffect(() => {
    if (!hint.shown) return;
    const timer = setTimeout(() => setHint((previous) => ({ ...previous, shown: false })), WATCH_HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);
  const shown = active && hint.shown;
  return { count: hint.count, shown, bump: () => setHint((previous) => ({ count: previous.count + 1, shown: true })) };
}

/** Grok's full computer view: the bot's screen on a dark cover, Exit fullscreen in the top right, and the control pill
 * under the frame. Without a frame it shows `note` (waking up, connecting, or what is in the way). */
export function ComputerFullscreen({ label, onExit, frame, note, control, alert, onKeyboard, embedded = false, expanded = true, aspect = 16 / 10 }: {
  label: string;
  /** The screen's width over its height, so the frame meets it edge to edge; bot desktops are 16:10. */
  aspect?: number;
  onExit: () => void;
  frame: ReactNode;
  note: ReactNode;
  control: ScreenControl | null;
  alert?: string | null;
  /** On a phone: opens the phone's keyboard to type on the screen. */
  onKeyboard?: () => void;
  embedded?: boolean;
  expanded?: boolean;
}) {
  // an embedded screen grows out of its place in the window and shrinks back into it, rather than jumping
  const [lastExpanded, setLastExpanded] = useState(expanded);
  const [closing, setClosing] = useState(false);
  if (embedded && lastExpanded !== expanded) {
    setLastExpanded(expanded);
    setClosing(!expanded);
  }
  const inline = embedded && !expanded && !closing;
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onExit);
  close.current = onExit;
  const mount = useRef<HTMLDivElement>(null);
  const [host] = useState(() => embedded && typeof document !== "undefined" ? document.createElement("div") : null);
  useLayoutEffect(() => {
    if (!host) return;
    host.style.display = "contents";
    (inline ? mount.current : document.body)?.append(host);
  }, [host, inline]);
  useLayoutEffect(() => () => { host?.remove(); }, [host]);
  const opened = useRef(!embedded || expanded);
  useLayoutEffect(() => {
    if (!embedded) return;
    const node = box.current;
    const wasOpen = opened.current;
    opened.current = !inline;
    if (!node || inline || (wasOpen && !closing)) return;
    const motion = growFromPlace(node, mount.current, closing);
    if (!closing) return () => motion.cancel();
    let live = true;
    motion.finished.then(() => { if (live) setClosing(false); }, () => {});
    return () => { live = false; motion.cancel(); };
  }, [embedded, inline, closing]);
  const { dragProps, noDragStyle } = useCaptionChrome();
  const macInset = useDesktopCapabilities().capabilities.windowChrome === "mac-inset";
  const exit = t("desktopViewer.exitFullscreen");
  const watching = Boolean(control && !control.held && control.onTake);
  const hint = useWatchHint(watching);
  const platform = useContext(PlatformContext);
  const phone = platform && !inline ? platform : null;

  const content = (
    <div
      ref={inline ? undefined : box}
      role={inline ? undefined : "dialog"}
      aria-modal={inline ? undefined : true}
      aria-label={label}
      tabIndex={-1}
      data-computer-fullscreen={inline ? undefined : ""}
      className={cn(inline ? "relative flex size-full flex-col outline-none" : "fixed inset-0 z-[65] flex flex-col bg-[rgb(20,20,20)] outline-none",
        phone && "pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]")}
    >
      {!inline && <ComputerViewerKeys box={box} onExit={onExit} />}
      {phone && <PhoneViewerBar platform={phone} onExit={() => close.current()} onKeyboard={onKeyboard} />}
      {!inline && !phone && <div {...dragProps} className={cn("flex h-11 shrink-0 items-center justify-end pr-2", macInset ? "pl-[88px]" : "pl-2")}>
        <button
          type="button"
          style={noDragStyle}
          onClick={() => close.current()}
          aria-label={exit}
          title={exit}
          data-computer-exit=""
          className="flex size-6 cursor-pointer items-center justify-center rounded-[6px] text-white/85 transition-[background-color,color] duration-[120ms] ease-[ease] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70"
        >
          <Icon name="arrows-contract-simple" size={14} />
        </button>
      </div>}
      <div className={cn("flex min-h-0 flex-1 flex-col", !inline && "p-2")}>
        <div className={cn("relative flex min-h-0 flex-1 flex-col items-center justify-center [container-type:size]", phone && "[--computer-bar:52px] landscape:[--computer-bar:0px]")}>
          {frame ? (
            <div
              data-computer-frame=""
              className={cn("relative overflow-hidden", inline ? "size-full" : "rounded-[6px] bg-white/4")}
              style={inline ? undefined : { width: `min(100cqw, calc((100cqh - ${control ? phone ? "var(--computer-bar)" : `${BAR}px` : "0px"}) * ${aspect}))`, aspectRatio: String(aspect) }}
              onPointerDown={watching ? hint.bump : undefined}
            >
              {frame}
            </div>
          ) : (
            <div data-computer-note="" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">{note}</div>
          )}
          {!inline && control && (
            <div className={cn("flex shrink-0 items-center justify-center", phone && "landscape:pointer-events-none landscape:absolute landscape:inset-x-0 landscape:bottom-1 landscape:h-auto! [&>*]:pointer-events-auto")} style={{ height: BAR }}>
              <ControlPill control={control} hint={hint} />
            </div>
          )}
          {alert && <p role="alert" className="absolute inset-x-0 top-2 mx-auto w-fit max-w-[80%] rounded-full bg-menu px-3 py-1 text-center text-[12px] leading-4 text-danger">{alert}</p>}
        </div>
      </div>
    </div>
  );
  return embedded ? host ? <><div ref={mount} className="size-full" />{createPortal(content, host)}</> : content : createPortal(content, document.body);
}

const landscapeQuery = () => typeof matchMedia === "function" ? matchMedia("(orientation: landscape)") : null;
const subscribeLandscape = (listener: () => void) => {
  const query = landscapeQuery();
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
};
const isLandscape = () => landscapeQuery()?.matches ?? false;

const phoneButton = "pointer-events-auto flex size-11 cursor-pointer items-center justify-center rounded-full text-white/85 transition-[background-color] duration-[120ms] ease-[ease] active:bg-white/12 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white/70";

/** The phone's way out of the screen, below the status bar, and the screen's own tools: turn it sideways and type. The
 * phone may turn while the screen is open. */
function PhoneViewerBar({ platform, onExit, onKeyboard }: { platform: MobilePlatform; onExit: () => void; onKeyboard?: () => void }) {
  const landscape = useSyncExternalStore(subscribeLandscape, isLandscape, () => false);
  const exit = useRef(onExit);
  exit.current = onExit;
  useEffect(() => {
    platform.orientation?.allowLandscape(true);
    const unback = platform.onBack?.(() => { exit.current(); return true; });
    return () => {
      unback?.();
      platform.orientation?.allowLandscape(false);
    };
  }, [platform]);
  const back = t("common.back");
  const rotate = t("desktopViewer.rotate");
  const keyboard = t("desktopViewer.keyboard");
  return (
    <div data-computer-phone-bar="" className="pointer-events-none flex h-11 shrink-0 items-center justify-between px-1 landscape:absolute landscape:inset-y-0 landscape:left-[env(safe-area-inset-left)] landscape:right-[env(safe-area-inset-right)] landscape:z-10 landscape:h-auto landscape:items-start landscape:py-1">
      <button type="button" onClick={onExit} aria-label={back} title={back} data-computer-exit="" className={phoneButton}>
        <Icon name="chevron-left" size={22} />
      </button>
      <div className="flex items-center gap-1 landscape:flex-col">
        {platform.orientation && (
          <button type="button" onClick={() => platform.orientation?.rotate(landscape ? "portrait" : "landscape")} aria-label={rotate} title={rotate} data-computer-rotate="" className={phoneButton}>
            <RotateCw size={18} aria-hidden="true" />
          </button>
        )}
        {onKeyboard && (
          <button type="button" onClick={onKeyboard} aria-label={keyboard} title={keyboard} data-computer-keyboard="" className={phoneButton}>
            <Icon name="keyboard" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

export const SCREEN_GROW_MS = 240;

/** The full view opening out of (or closing back into) the screen's place in the window: its edges travel between that
 * box and the window's, as a clip, so nothing inside rescales or reflows. Reduced motion fades instead. */
function growFromPlace(node: HTMLElement, place: HTMLElement | null, closing: boolean): Animation {
  const timing: KeyframeAnimationOptions = { duration: SCREEN_GROW_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" };
  const rect = place?.getBoundingClientRect();
  const fade = [{ opacity: 0 }, { opacity: 1 }];
  if (reducedMotion() || !rect || rect.width === 0 || rect.height === 0) return node.animate(closing ? fade.reverse() : fade, timing);
  const from = `inset(${rect.top}px ${Math.max(0, innerWidth - rect.right)}px ${Math.max(0, innerHeight - rect.bottom)}px ${rect.left}px round 12px)`;
  const frames = [{ clipPath: from, opacity: 0.6 }, { clipPath: "inset(0px 0px 0px 0px round 0px)", opacity: 1 }];
  return node.animate(closing ? frames.reverse() : frames, timing);
}

function ComputerViewerKeys({ box, onExit }: { box: RefObject<HTMLDivElement | null>; onExit: () => void }) {
  useDialogKeys(box, onExit);
  return null;
}

function ControlPill({ control, hint }: { control: ScreenControl; hint: { count: number; shown: boolean } }) {
  const action = control.held ? control.onDone : control.onTake;
  const secondary = control.held && !control.asked;
  return (
    <div data-computer-control={control.held ? "held" : "watching"} className={cn("flex h-9 items-center gap-2.5 rounded-full bg-menu pl-3", action ? "pr-1" : "pr-3")}>
      <span aria-live="polite" className={cn("flex items-center gap-1.5 text-[13px] font-medium leading-[18px]", control.held ? "text-ink" : "text-ink/68")}>
        <Icon name={control.held ? "window-pointer-arrow" : "eye"} size={16} />
        {control.held ? t("computer.inControl") : t("computer.watching")}
        {hint.shown && <span className="sr-only">{t("computer.takeControlHint")}</span>}
      </span>
      {action && (
        <span className="relative inline-flex">
          {!control.held && (
            <span
              key={hint.count}
              aria-hidden="true"
              data-computer-hint={hint.shown ? "" : undefined}
              className={cn("pointer-events-none absolute inset-0 rounded-full opacity-0 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-app)_22%,transparent),0_0_14px_3px_color-mix(in_srgb,var(--color-app)_18%,transparent)]", hint.shown && "computer-watch-hint")}
            />
          )}
          <button
            type="button"
            onClick={action}
            disabled={control.busy}
            aria-busy={control.busy || undefined}
            className={cn(
              "relative inline-flex h-[26px] cursor-pointer items-center rounded-full px-2 text-[13px] leading-[18px] transition-[background-color] duration-[120ms] ease-[ease] enabled:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60 motion-reduce:enabled:active:scale-100",
              secondary
                ? "bg-ink/[0.06] text-ink enabled:hover:bg-ink/[0.1]"
                : "bg-ink text-app enabled:hover:bg-[color-mix(in_srgb,var(--color-ink)_88.5%,var(--color-menu))]",
            )}
          >
            <span className={cn(!control.held && control.pending && "invisible")}>
              {control.held ? (control.asked ? t("computer.done") : t("computer.stopControl")) : t("computer.takeControl")}
            </span>
            {!control.held && control.pending && (
              <span data-computer-taking="" aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
                <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
              </span>
            )}
          </button>
        </span>
      )}
    </div>
  );
}

/** What the cover says while there is no screen: the bot's mark over one quiet line, shimmering while it waits. */
export function ComputerFullscreenNote({ mark, text, busy, children }: { mark: ReactNode; text: ReactNode; busy: boolean; children?: ReactNode }) {
  return (
    <>
      <span className="flex flex-col items-center gap-2" role={busy ? "status" : undefined}>
        {mark}
        <span className={cn("max-w-[420px] text-[12px] leading-4 text-white/68 text-pretty", busy && "computer-waking-text")}>{text}</span>
      </span>
      {children}
    </>
  );
}

export const fullscreenActionCls = "inline-flex h-[26px] cursor-pointer items-center rounded-full bg-white/12 px-2.5 text-[13px] leading-[18px] text-white transition-[background-color] duration-[120ms] ease-[ease] hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white/70 disabled:opacity-50";
