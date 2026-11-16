import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2, Maximize, Shrink } from "../../icons";

import { browserStreamAccess, createPreviewStreamClient, type PreviewStreamClient, type PreviewStreamControl, type PreviewStreamInput } from "@/lib/browser-stream-client";
import { createLiveStreamClient, type LiveResume } from "@/lib/browser-stream-v1";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { blankPage, keepView, keptKey, keptView, localBrowserFixture, minutesSince, pageTitle, siteOf, tabLetter, useLocalBrowser, type ClosedTabView, type LocalBrowserState } from "@/lib/local-browser";
import { usePageVisible } from "@/lib/page-visible";
import { siteIconUrl } from "@/lib/site-icon";
import { browserScope, withBrowserScope } from "@/lib/team-browser";
import { api, useStore, type Bot } from "@/state/store";
import { BROWSER_HELD_ELSEWHERE } from "../../../shared/browser-held";
import type { BrowserTab } from "../browser/ChromeRow";
import { StreamSurface, type SurfaceConnect } from "../browser/StreamSurface";
import { buttonCls } from "./rows";

/** The frame around the page: the tab strip sits in it, and the shown tab is cut from the page's own surface. */
const frameTone = "bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)]";
const screenCls = `relative w-full overflow-hidden rounded-xl ${frameTone}`;

function SiteMark({ title, url }: { title: string; url: string }) {
  const icon = siteIconUrl(siteOf(url));
  const [loaded, setLoaded] = useState<string | null>(null);
  const shown = icon !== null && loaded === icon;
  return (
    <span aria-hidden="true" className={cn("relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[4px] text-[10px] font-medium leading-none text-ink-secondary", !shown && "bg-ink/[0.08]")}>
      {!shown && tabLetter(title, url)}
      {icon && <img src={icon} alt="" draggable={false} onLoad={(event) => { if (event.currentTarget.naturalWidth > 1) setLoaded(icon); }}
        className={cn("absolute inset-0 size-full object-contain", !shown && "invisible")} />}
    </span>
  );
}

function tabName(tab: { title: string; url: string }): string {
  return pageTitle(tab.title, tab.url) || siteOf(tab.url) || t("browser.panel.newTab");
}

/** The inward curve where the shown tab meets the page, on its `side`, so tab and page read as one piece. */
function Flare({ side }: { side: "left" | "right" }) {
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute bottom-0 size-2.5",
      side === "left" ? "-left-2.5 bg-[radial-gradient(circle_at_0_0,transparent_9.5px,var(--color-composer)_10px)]"
        : "-right-2.5 bg-[radial-gradient(circle_at_100%_0,transparent_9.5px,var(--color-composer)_10px)]")} />
  );
}

/**
 * The bot's tabs along the top of the page, as a browser draws them: the shown tab is cut from the page's surface and
 * the rest sit quiet in the frame. Tabs share the width down to a floor, then the strip scrolls, keeping the shown tab in
 * view.
 */
function TabStrip({ bot, tabs, selected, onSelect, dot }: {
  bot: Bot; tabs: readonly BrowserTab[]; selected: string | null; onSelect: (tab: BrowserTab) => void; dot: "working" | "waiting" | null;
}) {
  const strip = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = strip.current;
    if (!box) return;
    // only the strip scrolls, never the panel around it; a strip that fits again shows from its start
    const keep = () => {
      if (box.scrollWidth <= box.clientWidth + 1) { box.scrollLeft = 0; return; }
      const tab = box.querySelector<HTMLElement>(`[data-local-browser-tab="${CSS.escape(selected ?? "")}"]`);
      if (!tab) return;
      const edges = box.getBoundingClientRect(), shown = tab.getBoundingClientRect();
      if (shown.left < edges.left) box.scrollLeft -= edges.left - shown.left + 12;
      else if (shown.right > edges.right) box.scrollLeft += shown.right - edges.right + 12;
    };
    keep();
    const watch = new ResizeObserver(keep);
    watch.observe(box);
    return () => watch.disconnect();
  }, [selected, tabs.length]);
  return (
    <div ref={strip} role="tablist" aria-label={t("localBrowser.tabs", { name: bot.name })} data-local-browser-strip=""
      onWheel={(event) => { if (event.deltaY && !event.deltaX && strip.current) strip.current.scrollLeft += event.deltaY; }}
      className="relative flex h-[38px] shrink-0 items-end gap-0.5 overflow-x-auto overflow-y-hidden px-3 pt-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((tab) => {
        const chosen = tab.tabId === selected;
        const marked = tab.active && dot;
        return (
          <button key={tab.tabId} type="button" role="tab" aria-selected={chosen} data-local-browser-tab={tab.tabId}
            onClick={() => onSelect(tab)}
            className={cn("relative flex h-8 min-w-[76px] max-w-[200px] flex-1 basis-0 cursor-pointer items-center gap-1.5 rounded-t-[10px] px-2.5 text-left text-[12px] leading-4",
              "transition-[background-color,color,opacity] duration-150 ease-out starting:opacity-0",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
              chosen ? "z-10 bg-composer text-ink" : "text-ink-secondary hover:bg-ink/[0.04] hover:text-ink")}>
            {chosen && <><Flare side="left" /><Flare side="right" /></>}
            <SiteMark title={tab.title} url={tab.url} />
            <span dir="auto" className="min-w-0 flex-1 truncate">{tabName(tab)}</span>
            {marked && <span role="img" data-tab-dot={dot} aria-label={t(dot === "waiting" ? "localBrowser.waitingDot" : "localBrowser.workingDot")}
              className={cn("size-1.5 shrink-0 rounded-full", dot === "waiting" ? "bg-warning" : "bg-success")} />}
          </button>
        );
      })}
    </div>
  );
}

function tabsOf(value: unknown): BrowserTab[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tab) => tab && typeof tab === "object" && typeof tab.tabId === "string"
    ? [{ tabId: tab.tabId, title: typeof tab.title === "string" ? tab.title : "", url: typeof tab.url === "string" ? tab.url : "", active: tab.active === true }]
    : []);
}

/** The page as painted, kept for the next time this view opens. */
function snapshot(box: HTMLElement | null): string | null {
  const canvas = box?.querySelector("canvas");
  if (!canvas || !canvas.width || !canvas.height) return null;
  try { return canvas.toDataURL("image/jpeg", 0.8); } catch { return null; }
}

/**
 * The bot's browser while it has tabs open: its tabs joined to the live page, which the person uses together with the
 * bot. Their clicks and keys go straight in while the bot works; nobody takes the browser and nothing pauses. Open big
 * lays the same view over the window. What it last showed is kept, so coming back paints at once and goes live after.
 */
export function LocalBrowserLive({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const [fallback, setFallback] = useState(false);
  const stream = state.config?.browserEngine?.engine === "chrome" && !fallback;
  const scopedThread = browserScope(state.config?.team, bot.threadId).threadId;
  const key = keptKey(bot.id, bot.threadId);
  const [attempt, setAttempt] = useState(0);
  const [connected, setConnected] = useState(false);
  const [painted, setPainted] = useState(false);
  const [control, setControl] = useState<PreviewStreamControl | null>(null);
  const [tabs, setTabs] = useState<readonly BrowserTab[]>(() => fixtureTabs() ?? keptView(key).tabs ?? []);
  const [frame] = useState(() => keptView(key).frame ?? null);
  const [error, setError] = useState("");
  const [big, setBig] = useState(false);
  const pageVisible = usePageVisible();
  const clientRef = useRef<PreviewStreamClient | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const resume = useRef<LiveResume & { key: string }>({ key: "", viewer: "" });
  const help = state.computerControl?.[bot.id]?.help;
  const fixture = localBrowserFixture() !== null;
  const dot = help ? "waiting" : bot.busy || localBrowserFixture()?.working ? "working" : null;

  const connect = useCallback<SurfaceConnect>((target, events) => {
    // together: the person's input runs beside the bot's work, taking no hold
    const scope: Record<string, string> = scopedThread ? { threadId: scopedThread } : {};
    const together = { ...scope, together: "1" };
    if (stream) return createPreviewStreamClient({ access: browserStreamAccess(bot.id, window.location, together), ...target }, events);
    const resumeKey = `${bot.id}\n${bot.browserProfile ?? ""}${scopedThread ? `\n${scopedThread}` : ""}`;
    if (resume.current.key !== resumeKey) resume.current = { key: resumeKey, viewer: "" };
    return createLiveStreamClient(bot.id, events, (body, viewerId) => api(withBrowserScope(`/api/bots/${encodeURIComponent(bot.id)}/browser/action`, scope), {
      method: "POST", body: JSON.stringify({ ...body, viewerId }), timeoutMs: 120_000,
    }), resume.current, together, { width: target.width, height: target.height });
  }, [bot.id, bot.browserProfile, scopedThread, stream]);

  const interact = useCallback((input: PreviewStreamInput) => {
    if (clientRef.current?.send(input)) { setError(""); return; }
    if (controlRef.current?.controller === "another-viewer") setError(BROWSER_HELD_ELSEWHERE);
  }, []);
  const controlRef = useRef<PreviewStreamControl | null>(null);
  const onControl = useCallback((next: PreviewStreamControl | null) => { controlRef.current = next; setControl(next); }, []);
  const onClient = useCallback((client: PreviewStreamClient | null) => { clientRef.current = client; }, []);
  const onMessage = useCallback((message: Readonly<Record<string, unknown>>) => {
    if (message.type !== "tabs") return;
    const next = tabsOf(message.tabs);
    setTabs(next);
    keepView(key, { tabs: next });
  }, [key]);

  // Leaving the tab, closing the panel or switching bots keeps the last picture for the next open. A layout cleanup runs
  // before the page's own surface lets go of its canvas.
  useLayoutEffect(() => () => {
    const kept = snapshot(screenRef.current);
    if (kept) keepView(key, { frame: kept });
  }, [key]);

  // Open big lays the same view over the window; Escape brings it back, without reaching a dialog beneath.
  useEffect(() => {
    if (!big) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setBig(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [big]);

  const toggleBig = () => {
    // the view moves to the window and back, so what it shows now is what it paints first there
    const kept = snapshot(screenRef.current);
    if (kept) keepView(key, { frame: kept });
    setPainted(false);
    setBig((on) => !on);
  };
  const active = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
  const strip = tabs.filter((tab) => !blankPage(tab.url));
  const select = (tab: BrowserTab) => { if (!tab.active) interact({ type: "tabSelect", tabId: tab.tabId }); };
  const heldElsewhere = control?.controller === "another-viewer";
  const status = heldElsewhere ? BROWSER_HELD_ELSEWHERE : dot === "waiting" ? t("localBrowser.waiting") : dot === "working" ? t("localBrowser.using") : null;
  const lastFrame = keptView(key).frame ?? frame;

  const view = (
    <section data-local-browser="live" data-big={big || undefined} role={big ? "dialog" : undefined} aria-modal={big || undefined} aria-label={t("localBrowser.label", { name: bot.name })}
      className={big ? "fixed inset-0 z-50 flex flex-col gap-2 bg-app p-4 text-ink" : "flex flex-col gap-2"}>
      <div className={cn(screenCls, "flex flex-col", big && "min-h-0 flex-1")}>
        {strip.length > 0 && <TabStrip bot={bot} tabs={strip} selected={active?.tabId ?? null} onSelect={select} dot={dot} />}
        <div ref={screenRef} data-local-browser-page="" className={cn("relative w-full overflow-hidden bg-composer", big ? "min-h-0 flex-1" : "aspect-[16/10]", strip.length === 0 && "rounded-t-xl")}>
          {fixture ? <FixturePage tab={active} /> : pageVisible || big ? (
            <div className={cn("absolute inset-0 flex flex-col", !big && "pointer-events-none")} inert={!big || undefined}>
              <StreamSurface
                key={`${attempt}:${stream ? "stream" : "live"}:${bot.browserProfile ?? ""}`}
                connect={connect}
                input={interact}
                together
                label={t("localBrowser.page", { name: bot.name })}
                onClient={onClient}
                onControl={onControl}
                onMessage={onMessage}
                onFirstFrame={() => setPainted(true)}
                onConnectedChange={(next) => { setConnected(next); if (next) setError(""); }}
                onUnauthorized={() => { if (stream) setFallback(true); else setAttempt((n) => n + 1); }}
                onGone={() => setConnected(false)}
              />
            </div>
          ) : null}
          {!fixture && !painted && lastFrame && (
            <img src={lastFrame} alt="" aria-hidden="true" data-local-browser-kept="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain" />
          )}
          {!big && (
            // the page draws at a desktop's width, too small here to aim at: a click opens it big, where it is used
            <button type="button" data-local-browser-action="open-page" aria-label={t("localBrowser.openBig")} onClick={toggleBig}
              className="absolute inset-0 z-10 cursor-zoom-in focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus" />
          )}
          {!fixture && !connected && !lastFrame && (
            <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[12px] leading-4 text-ink/[0.56]">
              <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" />{t("browser.panel.connecting")}
            </div>
          )}
        </div>
      </div>
      {error && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{error}</p>}
      <div className="flex min-h-7 items-center gap-1.5">
        <span data-local-browser-status="" title={status ?? undefined} className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink/[0.56]">{status}</span>
        <button type="button" data-local-browser-action="big" className={buttonCls} onClick={toggleBig}>
          {big ? <Shrink size={13} aria-hidden="true" /> : <Maximize size={13} aria-hidden="true" />}
          {t(big ? "localBrowser.closeBig" : "localBrowser.openBig")}
        </button>
      </div>
    </section>
  );
  // over the whole window: the panel's own layers would hold a fixed view inside them
  return big ? <>{createPortal(view, document.body)}<div className="aspect-[16/10] w-full rounded-xl bg-ink/[0.04]" /></> : view;
}

function fixtureTabs(): BrowserTab[] | null {
  const tabs = localBrowserFixture()?.tabs;
  return tabs ? tabs.map((tab, at) => ({ tabId: `t${at + 1}`, title: tab.title, url: tab.url, active: at === 0 })) : null;
}

/** The gallery's page: its tab's own last screen, as the server would stream it. */
function FixturePage({ tab }: { tab: BrowserTab | null }) {
  const image = localBrowserFixture()?.tabs?.find((one) => one.url === tab?.url)?.image;
  return image ? <img src={image} alt="" className="absolute inset-0 size-full object-cover object-top" /> : null;
}

/** For 30 minutes after the browser closed: that it closed, and the tabs it closed with; one opens its last screen. */
export function LocalBrowserClosed({ bot, closed }: { bot: Bot; closed: NonNullable<LocalBrowserState["closed"]> }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => { setChosen(null); }, [closed.at]);
  const ago = minutesSince(closed.at, now);
  const when = ago < 1 ? t("localBrowser.justNow") : t("localBrowser.minutesAgo", { count: ago });
  const tab = chosen === null ? null : closed.tabs[chosen] ?? null;

  if (tab) {
    return (
      <section data-local-browser="last-screen" className="flex flex-col gap-2">
        <div className="flex min-h-7 items-center gap-2">
          <button type="button" data-local-browser-action="back" className={buttonCls} onClick={() => setChosen(null)}>
            <ArrowLeft size={13} aria-hidden="true" />{t("localBrowser.back")}
          </button>
          <span dir="auto" className="min-w-0 flex-1 truncate text-end text-[12px] leading-4 text-ink/[0.56]">{pageTitle(tab.title, tab.url) || siteOf(tab.url)} · {when}</span>
        </div>
        <div className={cn(screenCls, "aspect-[16/10]")}>
          {tab.image
            ? <img src={tab.image} alt={t("localBrowser.lastScreen", { title: pageTitle(tab.title, tab.url) || siteOf(tab.url) })} className="absolute inset-0 size-full object-cover object-top" />
            : <p className="absolute inset-0 m-0 flex items-center justify-center px-6 text-center text-[12px] leading-4 text-ink/[0.56]">{t("localBrowser.noScreen")}</p>}
        </div>
      </section>
    );
  }

  return (
    <section data-local-browser="closed" className="flex flex-col gap-2">
      <div className="flex flex-col items-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] px-5 py-5 text-center">
        <p className="m-0 text-[13px] font-medium leading-[18px] text-ink">{t("localBrowser.closedTitle")}</p>
        <p className="m-0 text-pretty text-[12px] leading-4 text-ink-secondary">{t("localBrowser.closedBody", { name: bot.name })}</p>
      </div>
      <h3 className="m-0 mt-1 px-1 text-[12px] font-normal leading-4 text-ink/[0.56]">{t("localBrowser.workedOn")}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {closed.tabs.map((one, index) => !blankPage(one.url) && (
          <li key={`${one.url}:${index}`}>
            <ClosedRow tab={one} when={when} onOpen={() => setChosen(index)} />
          </li>
        ))}
      </ul>
      <p className="m-0 px-1 text-[12px] leading-4 text-ink/[0.56]">{t("localBrowser.workedOnHint")}</p>
    </section>
  );
}

function ClosedRow({ tab, when, onOpen }: { tab: ClosedTabView; when: string; onOpen: () => void }) {
  const site = siteOf(tab.url);
  return (
    <button type="button" data-local-browser-closed-tab="" onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
      <span aria-hidden="true" className="relative flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink/[0.06]">
        {tab.image ? <img src={tab.image} alt="" loading="lazy" draggable={false} className="absolute inset-0 size-full object-cover object-top" /> : <SiteMark title={tab.title} url={tab.url} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="auto" className="truncate text-[13px] leading-[18px] text-ink">{pageTitle(tab.title, tab.url) || site}</span>
        <span className="truncate text-[12px] leading-4 text-ink/[0.56]">{site}</span>
      </span>
      <span className="shrink-0 text-[12px] leading-4 text-ink/[0.56]">{when}</span>
    </button>
  );
}

/** A bot's browser on this computer in its Computer tab: the live tabs while it is open, what it closed with for 30
 * minutes after, and nothing otherwise. */
export function LocalBrowserSection({ bot, after }: { bot: Bot; after?: ReactNode }) {
  const { open, closed, known } = useLocalBrowser(bot.id, bot.threadId, bot.browser !== false);
  // what comes after waits for the first answer, briefly, so it never shows alone and is then pushed down
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (known) return;
    const timer = setTimeout(() => setLate(true), 1_500);
    return () => clearTimeout(timer);
  }, [known]);
  return (
    <>
      {open ? <LocalBrowserLive key={`${bot.id}\n${bot.threadId ?? ""}`} bot={bot} /> : closed ? <LocalBrowserClosed bot={bot} closed={closed} /> : null}
      {(known || late) && after}
    </>
  );
}

/** A bot's browser on this computer while it is open, above this computer's screen; nothing otherwise. */
export function LocalBrowserOpen({ bot }: { bot: Bot }) {
  const { open } = useLocalBrowser(bot.id, bot.threadId, bot.browser !== false);
  return open ? <div data-local-browser-first="" className="mb-3"><LocalBrowserLive key={`${bot.id}\n${bot.threadId ?? ""}`} bot={bot} /></div> : null;
}
