// The tabs a bot's browser had open when it closed (idle close, its bot stopped, or the person closed it), kept in memory for an hour so
// the Computer tab can say what it worked on: title, address and the last screen of each. Never written to disk; a
// restart of the server forgets them, as does a browser that opens again.

export interface ClosingTab {
  title: string;
  url: string;
  active?: boolean;
  /** The tab's last screen as JPEG, or null when it could not be pictured in time. */
  image: Buffer | null;
}

export interface ClosedTab {
  title: string;
  url: string;
  image: Buffer | null;
}

export interface ClosedBrowser {
  at: number;
  tabs: ClosedTab[];
}

export const RECENT_TABS_MS = 60 * 60_000;
/** At most this many tabs are pictured and kept: the most a profile opens on the new browser. */
export const RECENT_TABS_LIMIT = 8;
/** A larger last screen is dropped rather than kept in memory. */
const IMAGE_LIMIT = 2 * 1024 * 1024;

/** Only pages a person would recognise: http(s) addresses, credentials stripped. */
export function shownUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return null;
  }
}

function shown(tabs: readonly ClosingTab[]): ClosedTab[] {
  return [...tabs].sort((a, b) => Number(b.active === true) - Number(a.active === true)).flatMap((tab): ClosedTab[] => {
    const url = shownUrl(tab.url);
    if (!url) return [];
    const title = typeof tab.title === "string" ? tab.title.slice(0, 512) : "";
    const image = tab.image && tab.image.length > 0 && tab.image.length <= IMAGE_LIMIT ? tab.image : null;
    return [{ title, url, image }];
  }).slice(0, RECENT_TABS_LIMIT);
}

export class RecentTabs {
  readonly #closed = new Map<string, ClosedBrowser>();
  readonly #now: () => number;
  readonly #keepMs: number;

  constructor({ now = Date.now, keepMs = RECENT_TABS_MS }: { now?: () => number; keepMs?: number } = {}) {
    this.#now = now;
    this.#keepMs = keepMs;
  }

  /** Tabs closed one conversation at a time while the browser stays open, newest first. */
  readonly #byChat = new Map<string, ClosedBrowser>();

  /** A session's browser closed with these tabs; the active one first. Nothing worth showing forgets the session. */
  record(session: string, tabs: readonly ClosingTab[]): void {
    this.#prune();
    const kept = shown(tabs);
    if (kept.length === 0) this.#closed.delete(session);
    else this.#closed.set(session, { at: this.#now(), tabs: kept });
  }

  /** A finished conversation's tabs closed in a browser that stays open; kept beside the earlier ones for the same time. */
  add(session: string, tabs: readonly ClosingTab[]): void {
    this.#prune();
    const kept = shown(tabs);
    if (kept.length === 0) return;
    const earlier = this.#byChat.get(session)?.tabs ?? [];
    this.#byChat.set(session, { at: this.#now(), tabs: [...kept, ...earlier].slice(0, RECENT_TABS_LIMIT) });
  }

  /** What the browser closed with, then the conversations' tabs it closed before. */
  get(session: string): ClosedBrowser | null {
    this.#prune();
    const whole = this.#closed.get(session);
    const chats = this.#byChat.get(session);
    if (!whole || !chats) return whole ?? chats ?? null;
    return { at: Math.max(whole.at, chats.at), tabs: [...whole.tabs, ...chats.tabs].slice(0, RECENT_TABS_LIMIT) };
  }

  forget(session: string): void {
    this.#closed.delete(session);
    this.#byChat.delete(session);
  }

  #prune(): void {
    const now = this.#now();
    for (const kept of [this.#closed, this.#byChat]) {
      for (const [session, closed] of kept) if (now - closed.at >= this.#keepMs) kept.delete(session);
    }
  }
}

export const recentTabs = new RecentTabs();

/** Resolves to the value, or null when it does not settle in time or fails. */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
    promise.then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
  });
}
