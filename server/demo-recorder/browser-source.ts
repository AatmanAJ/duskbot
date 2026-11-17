import { valueInWorld } from "../browser/cdp/evaluate.ts";
import type { PointerReporter } from "../browser/cdp/actions.ts";
import type { CdpPage } from "../browser/cdp/page.ts";
import type { Screenshot } from "../browser/cdp/screencast.ts";
import { personUrl } from "../browser/dispatch.ts";
import { createDomProbe, createDomSurface, type PageEvaluate } from "./accessibility/dom.ts";
import type { AccessibilityProbe, ScreenSource } from "./capture.ts";
import type { DemoSeat } from "./host.ts";
import type { ReplaySurface } from "./replay.ts";

/** What a recording and a replay need of one bot's browser. */
export interface BrowserDemoAccess {
  /** The page in front, or null while the browser is not running. */
  page(): CdpPage | null;
  still(): Promise<Screenshot | null>;
  /** One action on the page in front, run as the bot's own are; starts the browser when it is asleep. */
  act<T>(work: (page: CdpPage, pointer: PointerReporter | undefined) => Promise<T>): Promise<T>;
}

const OPEN_TIMEOUT_MS = 30_000;

/** A bot's browser as a recording reads it and a replay drives it: the page's own structure, read where the page's scripts cannot reach. */
export function browserDemoSource(access: BrowserDemoAccess): { probe: AccessibilityProbe; screen: ScreenSource; surface: ReplaySurface } {
  const evaluate: PageEvaluate = async (expression) => {
    const page = access.page();
    if (!page || page.closed) throw new Error("The browser has no page open.");
    return valueInWorld<unknown>(page.frames, page.frames.mainFrameId, expression);
  };
  const screen: ScreenSource = {
    async frame() {
      const shot = await access.still();
      return shot ? { data: shot.data, type: shot.format === "png" ? "image/png" : "image/jpeg", width: shot.width, height: shot.height, scale: shot.scale } : null;
    },
  };
  const surface = createDomSurface(evaluate, {
    async open(url) {
      const address = personUrl(url);
      if (!address) throw new Error("That address cannot be opened.");
      await access.act((page) => page.navigate(address, { readiness: "load", timeoutMs: OPEN_TIMEOUT_MS }));
    },
    clickAt: async (x, y) => { await access.act((page, pointer) => page.click({ x, y }, pointer ? { pointer } : {})); },
    hover: async (x, y) => { await access.act((page, pointer) => page.hover({ x, y }, pointer ? { pointer } : {})); },
    insertText: (text) => access.act((page) => page.keyboard.insertText(text)),
    insertSecret: (text) => access.act(async (page) => {
      // Security: armed before the secret is typed, so no screenshot or page script of the bot's can read it back.
      page.secrets.arm(page.frames, [text]);
      await page.keyboard.insertText(text);
    }),
    press: async (key) => { await access.act((page) => page.press(key)); },
  });
  return { probe: createDomProbe(evaluate), screen, surface };
}

/** That browser as the seat a task is shown at: `tap` says where the person's input is heard. */
export function browserDemoSeat(access: BrowserDemoAccess, tap: DemoSeat["tap"]): DemoSeat {
  return { ...browserDemoSource(access), tap, where: () => access.page()?.url() ?? "" };
}
