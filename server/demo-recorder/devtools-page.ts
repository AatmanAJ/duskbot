import type { Cdp } from "../browser-sites.ts";
import { Mouse } from "../browser/cdp/input.ts";
import { Keyboard } from "../browser/cdp/keyboard.ts";
import { createDomProbe, createDomSurface, type PageEvaluate } from "./accessibility/dom.ts";
import type { AccessibilityProbe, ScreenSource } from "./capture.ts";
import { imageSize, type ScreenFrame } from "./frames.ts";
import type { ReplaySurface } from "./replay.ts";

const WORLD = "dusk-demo";
const LOAD_TIMEOUT_MS = 30_000;
const LOAD_POLL_MS = 100;

interface TargetInfo {
  targetId: string;
  type: string;
  url: string;
}

/**
 * One page of a browser, reached over a DevTools connection of its own: read in a world the page's scripts cannot
 * see, and given real input. For a browser that dusk bot's own driver does not run.
 */
export class DevToolsPage {
  readonly mouse: Mouse;
  readonly keyboard: Keyboard;
  readonly #cdp: Cdp;
  readonly #session: string;
  #context: number | null = null;

  private constructor(cdp: Cdp, session: string, mac: boolean) {
    this.#cdp = cdp;
    this.#session = session;
    const sender = { send: <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) => cdp.send(method, params, session) as Promise<T> };
    this.keyboard = new Keyboard(sender, { mac });
    this.mouse = new Mouse(sender, this.keyboard);
  }

  /**
   * The page a person is looking at: the tab in front (the one showing `url` when more than one says it is), or with
   * none in front the one showing `url`, or the newest. Null when the browser has no page.
   */
  static async open(cdp: Cdp, options: { url?: string; mac?: boolean } = {}): Promise<DevToolsPage | null> {
    const { targetInfos } = await cdp.send("Target.getTargets") as { targetInfos?: TargetInfo[] };
    const pages = (targetInfos ?? []).filter((target) => target.type === "page" && !/^(devtools|chrome-extension):/.test(target.url));
    const found: Array<{ page: DevToolsPage; shows: boolean; front: boolean }> = [];
    for (const target of pages.toReversed()) {
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }) as { sessionId?: string };
      if (typeof sessionId !== "string") continue;
      const page = new DevToolsPage(cdp, sessionId, options.mac ?? process.platform === "darwin");
      found.push({ page, shows: Boolean(options.url) && target.url === options.url, front: pages.length === 1 || await page.inFront() });
    }
    const chosen = found.find((each) => each.front && each.shows) ?? found.find((each) => each.front) ?? found.find((each) => each.shows) ?? found[0];
    for (const each of found) if (each !== chosen) each.page.leave();
    return chosen?.page ?? null;
  }

  /** Whether this is the tab its window shows. */
  async inFront(): Promise<boolean> {
    return await this.evaluate("document.visibilityState === \"visible\"").catch(() => false) === true;
  }

  leave(): void {
    void this.#cdp.send("Target.detachFromTarget", { sessionId: this.#session }).catch(() => {});
  }

  #send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.#cdp.send(method, params, this.#session);
  }

  async #world(): Promise<number> {
    if (this.#context !== null) return this.#context;
    const { frameTree } = await this.#send("Page.getFrameTree") as { frameTree?: { frame?: { id?: string } } };
    const made = await this.#send("Page.createIsolatedWorld", { frameId: frameTree?.frame?.id, worldName: WORLD });
    if (typeof made.executionContextId !== "number") throw new Error("The page gave no place to read it from.");
    this.#context = made.executionContextId;
    return this.#context;
  }

  /** An expression's JSON value, from the isolated world; a navigation ends that world, so one failure makes a new one. */
  async evaluate(expression: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        const answer = await this.#send("Runtime.evaluate", { expression, contextId: await this.#world(), returnByValue: true }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
        if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text ?? "The page could not answer.");
        return answer.result?.value;
      } catch (error) {
        const lost = this.#context !== null;
        this.#context = null;
        if (attempt > 0 || !lost) throw error;
      }
    }
  }

  async still(): Promise<ScreenFrame | null> {
    const metrics = await this.#send("Page.getLayoutMetrics") as { cssVisualViewport?: { clientWidth?: number } };
    const shot = await this.#send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    if (typeof shot.data !== "string") return null;
    const data = Buffer.from(shot.data, "base64");
    const size = imageSize(data);
    const shown = metrics.cssVisualViewport?.clientWidth;
    if (!size || !shown) return null;
    return { data, type: "image/jpeg", width: size.width, height: size.height, scale: size.width / shown };
  }

  async navigate(url: string): Promise<void> {
    await this.#send("Page.navigate", { url });
    this.#context = null;
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LOAD_POLL_MS));
      if (await this.evaluate("document.readyState === \"complete\" && location.href !== \"about:blank\"").catch(() => false) === true) return;
    }
    throw new Error("The page took too long to open.");
  }

  async url(): Promise<string> {
    const value = await this.evaluate("location.href").catch(() => "");
    return typeof value === "string" ? value : "";
  }
}

/**
 * A recording's and a replay's view of such a page. `page` gives the page as it is now, `gate` runs each action of a
 * replay, and `lost` hears that the page stopped answering (its tab closed, or another came to the front).
 */
export function devToolsDemoSource(page: () => Promise<DevToolsPage>, gate: <T>(work: () => Promise<T>) => Promise<T> = (work) => work(), lost: () => void = () => {}): { probe: AccessibilityProbe; screen: ScreenSource; surface: ReplaySurface } {
  const evaluate: PageEvaluate = async (expression) => {
    try {
      return await (await page()).evaluate(expression);
    } catch (error) {
      lost();
      throw error;
    }
  };
  const acting = <T>(work: (page: DevToolsPage) => Promise<T>) => gate(async () => work(await page()));
  const surface = createDomSurface(evaluate, {
    async open(url) {
      if (!/^https?:\/\//i.test(url)) throw new Error("That address cannot be opened.");
      await acting((now) => now.navigate(url));
    },
    clickAt: (x, y) => acting((now) => now.mouse.click(x, y)),
    insertText: (text) => acting((now) => now.keyboard.insertText(text)),
    press: (key) => acting((now) => now.keyboard.press(key)),
  });
  return { probe: createDomProbe(evaluate), screen: { frame: async () => (await page()).still() }, surface };
}
