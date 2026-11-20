import { useEffect, useState } from "react";

import { api, ApiError } from "@/state/api";
import { usePageVisible } from "./page-visible";
import { trailError } from "./trail";

export interface ClosedTabView {
  title: string;
  url: string;
  /** The last screen's address, or null when none was kept. */
  image: string | null;
}

export interface LocalBrowserState {
  open: boolean;
  closed: { at: number; tabs: ClosedTabView[] } | null;
}

const POLL_MS = 5_000;
const RETRY_MS = 1_000;
const NONE: LocalBrowserState = { open: false, closed: null };

/** The surfaces gallery's stand-in for the server's answer; `tabs`, an open browser's tabs, each with a still page, and
 * `held`, the one the person holds. */
export type LocalBrowserFixture = LocalBrowserState & { tabs?: ClosedTabView[]; working?: boolean; held?: number };
let fixture: LocalBrowserFixture | null = null;
export function setLocalBrowserFixture(next: LocalBrowserFixture | null): void { fixture = next; }
export const localBrowserFixture = (): LocalBrowserFixture | null => fixture;

export function recentPath(botId: string, threadId: string | undefined, index?: number): string {
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  return `/api/bots/${encodeURIComponent(botId)}/browser/recent${index === undefined ? "" : `/${index}`}${query}`;
}

export function parseLocalBrowser(value: unknown, botId: string, threadId: string | undefined): LocalBrowserState {
  const reply = value as { open?: unknown; closed?: { at?: unknown; tabs?: unknown } | null } | null;
  const at = reply?.closed?.at;
  const tabs = Array.isArray(reply?.closed?.tabs) ? reply.closed.tabs : [];
  const closed = typeof at === "number" && tabs.length > 0 ? {
    at,
    tabs: tabs.flatMap((tab: { title?: unknown; url?: unknown; image?: unknown }, index: number) => typeof tab?.url === "string"
      ? [{ title: typeof tab.title === "string" ? tab.title : "", url: tab.url, image: tab.image === true ? `${recentPath(botId, threadId, index)}${threadId ? "&" : "?"}at=${at}` : null }]
      : []),
  } : null;
  return { open: reply?.open === true, closed };
}

/** The server's answer; a failed ask is tried once more before the panel counts it as nothing open. */
export async function askLocalBrowser(ask: () => Promise<unknown>, wait: (ms: number) => Promise<void>, signal: AbortSignal): Promise<unknown> {
  try {
    return await ask();
  } catch (error) {
    if (signal.aborted) throw error;
    await wait(RETRY_MS);
    if (signal.aborted) throw error;
    return ask();
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the Computer tab last knew of a bot's browser, kept while the app runs: leaving the tab, closing the panel or
 * switching bots and coming back shows it at once, and the server's answer and the live page only confirm it. */
export interface KeptView {
  state?: LocalBrowserState;
  tabs?: readonly { tabId: string; title: string; url: string; active: boolean }[];
  /** The page as last painted, as an image address. */
  frame?: string;
}
const keptViews = new Map<string, KeptView>();
export const keptKey = (botId: string, threadId: string | undefined) => `${botId}\n${threadId ?? ""}`;
export function keptView(key: string): KeptView { return keptViews.get(key) ?? {}; }
export function keepView(key: string, patch: KeptView): void {
  keptViews.set(key, { ...keptViews.get(key), ...patch });
  // a handful of bots is all a person switches between
  if (keptViews.size > 24) keptViews.delete(keptViews.keys().next().value!);
}

/** Whether a bot's browser on this computer is open now, and what it closed with in the last hour. Asked again every
 * few seconds while the page shows; asking never starts the browser. Starts from what was last known for the bot. */
export function useLocalBrowser(botId: string, threadId: string | undefined, enabled: boolean): LocalBrowserState & { known: boolean } {
  const key = keptKey(botId, threadId);
  const known = () => fixture ?? keptView(key).state ?? null;
  const [held, setHeld] = useState(() => ({ key, state: known() }));
  // another bot or conversation: what was last known of it, never the previous one's
  const state = (held.key === key ? held.state : known());
  const visible = usePageVisible();
  useEffect(() => {
    if (fixture) { setHeld({ key, state: fixture }); return; }
    if (!enabled || !visible) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failing = false;
    const ask = async () => {
      try {
        const answer = await askLocalBrowser(() => api(recentPath(botId, threadId), { background: true, signal: controller.signal }), pause, controller.signal);
        const next = parseLocalBrowser(answer, botId, threadId);
        if (controller.signal.aborted) return;
        failing = false;
        keepView(key, { state: next });
        setHeld((current) => current.key === key && current.state && sameState(current.state, next) ? current : { key, state: next });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!failing) trailError("local-browser.poll", error, { bot: botId, status: error instanceof ApiError ? error.status : null });
        failing = true;
        // an older server without the route, or a blip: the panel keeps what it showed, and counts as answered
        setHeld((current) => current.key === key && current.state ? current : { key, state: NONE });
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void ask(), POLL_MS);
      }
    };
    void ask();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [botId, threadId, enabled, visible, key]);
  return { ...(state ?? NONE), known: state !== null || !enabled };
}

function sameState(a: LocalBrowserState, b: LocalBrowserState): boolean {
  return a.open === b.open && a.closed?.at === b.closed?.at && a.closed?.tabs.length === b.closed?.tabs.length;
}

/** The site a person recognises: the host without a leading www. */
export function siteOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

/** A page's own title; agent-browser names a page it has no title for by its address, which is no title at all. */
export function pageTitle(title: string, url: string): string {
  const trimmed = title.trim();
  const bare = (value: string) => value.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  return trimmed && bare(trimmed) !== bare(url) && bare(trimmed) !== siteOf(url) ? trimmed : "";
}

/** A tab with nothing on it yet, which the strip leaves out. */
export function blankPage(url: string): boolean {
  const bare = url.trim().toLowerCase();
  return !bare || bare === "about:blank" || bare.startsWith("chrome://newtab") || bare.startsWith("chrome://new-tab-page") || bare.startsWith("chrome-search://");
}

/** One letter for a tab with no icon: the site's, else the title's. */
export function tabLetter(title: string, url: string): string {
  const source = siteOf(url) || title;
  return (source.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();
}

/** What the line above the browser says: the bot browsing while its turn has acted in the browser, else that it is open. */
export function browserHeadline({ busy, turnStartedAt, actedAt, working }: { busy: boolean; turnStartedAt: number | undefined; actedAt: number | null; working?: boolean }): "browsing" | "open" {
  if (working) return "browsing";
  return busy && actedAt !== null && actedAt >= (turnStartedAt ?? 0) ? "browsing" : "open";
}

export function closePath(botId: string, threadId: string | undefined): string {
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  return `/api/bots/${encodeURIComponent(botId)}/browser/close${query}`;
}

/** Closes the bot's browser on this computer; its tabs stay listed for an hour. */
export async function closeLocalBrowser(botId: string, threadId: string | undefined): Promise<boolean> {
  const answer = await api(closePath(botId, threadId), { method: "POST", body: "{}" }) as { closed?: unknown } | null;
  return answer?.closed === true;
}
