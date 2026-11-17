import type { Cdp } from "../browser-sites.ts";
import type { DemoTap } from "../browser/viewers/demo-tap.ts";
import { DevToolsPage, devToolsDemoSource } from "./devtools-page.ts";
import type { DemoSeat } from "./host.ts";

/** What a task shown in the older engine's browser needs of that browser's live view. */
export interface LiveDemoBrowser {
  /** A DevTools client of its own on the session's browser, and the address its view shows; null with no view open. */
  demoCdp(session: string): Promise<{ cdp: Cdp; url(): string } | null>;
  /** Runs work beside the bot's own, refused while a person holds the browser. */
  demoShared<T>(session: string, work: () => Promise<T>): Promise<T>;
  readonly demoTaps: Map<string, DemoTap>;
}

const NO_VIEW = "Open this bot's browser first, then try again.";

/** The seat a task is shown at, and done again at, in a browser the older engine runs. */
export function liveDemoSeat(live: LiveDemoBrowser, session: string): DemoSeat {
  let link: { cdp: Cdp; url(): string } | null = null;
  let page: DevToolsPage | null = null;
  let last = "";
  const current = async (): Promise<DevToolsPage> => {
    if (page) return page;
    link ??= await live.demoCdp(session);
    if (!link) throw new Error(NO_VIEW);
    last = link.url() || last;
    page = await DevToolsPage.open(link.cdp, last ? { url: last } : {});
    if (!page) throw new Error("The browser has no page open.");
    return page;
  };
  const source = devToolsDemoSource(current, (work) => live.demoShared(session, work), () => { page = null; });
  return {
    ...source,
    tap(tap) {
      if (tap) live.demoTaps.set(session, tap);
      else live.demoTaps.delete(session);
    },
    where: () => link?.url() || last,
    close() {
      live.demoTaps.delete(session);
      link?.cdp.close();
      link = null;
      page = null;
    },
  };
}
