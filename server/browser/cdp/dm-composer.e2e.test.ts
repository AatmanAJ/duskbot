// A chat site's composer on real Chrome: a contenteditable textbox the page swaps for a new node when it takes focus or
// re-renders between the snapshot and the action, in the page, an open shadow root, a same-site and a cross-site frame.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "../../testing/host-timeout.ts";
import { threadPage, type ComposerPlace } from "../testing/dm-composer.ts";
import type { CdpPage } from "./page.ts";
import { FixtureServer } from "./testing/fixtures.ts";
import { CHROME, startChrome, type RunningChrome } from "./testing/real-chrome.ts";

const suite = CHROME ? describe : describe.skip;

type Where = ComposerPlace | "cross-site frame";

suite("a DM composer that re-renders on real Chrome", () => {
  let fx: FixtureServer;
  let run: RunningChrome;
  let page: CdpPage;
  let pages = 0;

  beforeAll(async () => {
    fx = await FixtureServer.start();
    run = await startChrome("dm-composer");
    page = await run.browser.waitForPage();
  }, hostTimeout(180_000));

  afterAll(async () => {
    await run?.close();
    await fx?.close();
  });

  /** Opens a thread and answers how to read its `dm` state, which lives in the composer's own frame. */
  async function open(where: Where): Promise<(expression: string) => Promise<unknown>> {
    const n = ++pages;
    const inner = fx.page(`/inner${n}`, threadPage("page"));
    const frameUrl = where === "cross-site frame" ? fx.crossSiteUrl(`/inner${n}`) : inner;
    const url = fx.page(`/thread${n}`, threadPage(where === "cross-site frame" ? "frame" : where, frameUrl));
    await page.navigate(url);
    const framed = where === "frame" || where === "cross-site frame";
    const deadline = Date.now() + 10_000;
    for (;;) {
      const frame = framed ? page.frames.all().find((candidate) => candidate.id !== page.frames.mainFrameId) : page.frames.main;
      const ready = frame ? await page.evaluate("typeof dm === 'object'", { frameId: frame.id, world: "page" }).catch(() => false) : false;
      if (frame && ready) return (expression) => page.evaluate(expression, { frameId: frame.id, world: "page" });
      if (Date.now() > deadline) throw new Error("The framed thread never loaded.");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async function composerRef(): Promise<string> {
    const { tree } = await page.snapshot();
    const ref = /- textbox "Message" \[ref=(e\d+)\]/.exec(tree)?.[1];
    if (!ref) throw new Error(`No composer in:\n${tree}`);
    return ref;
  }

  const places: Where[] = ["page", "shadow", "frame", "cross-site frame"];

  for (const where of places) {
    it(`types a multi-line draft into a composer in the ${where} that is swapped after the snapshot and again on focus`, async () => {
      const dm = await open(where);
      const ref = await composerRef();
      await dm("dm.rerender()");
      await page.type({ ref }, "hey there\nsecond line");
      expect(await dm("dm.draft()")).toBe("hey there\nsecond line");
      expect(await dm("dm.sent.length")).toBe(0);
      expect(await dm("dm.renders")).toBeGreaterThanOrEqual(3);
    }, hostTimeout(60_000));
  }

  it("clicks a swapped composer, then types into what has focus", async () => {
    const dm = await open("page");
    const ref = await composerRef();
    await dm("dm.rerender()");
    await page.click({ ref });
    await page.type(null, "after a click");
    expect(await dm("dm.draft()")).toBe("after a click");
  }, hostTimeout(60_000));

  it("fills a swapped composer, replacing its draft, and the ref keeps working after more renders", async () => {
    const dm = await open("shadow");
    const ref = await composerRef();
    await page.type({ ref }, "old draft");
    await dm("dm.rerender()");
    await page.fill({ ref }, "new draft");
    expect(await dm("dm.draft()")).toBe("new draft");
    await dm("dm.rerender()");
    await page.press("Enter");
    expect(await dm("dm.sent")).toEqual(["new draft"]);
    await dm("dm.rerender()");
    await page.type({ ref }, "next");
    expect(await dm("dm.draft()")).toBe("next");
  }, hostTimeout(60_000));

  it("still calls a ref stale when the page no longer has a matching element", async () => {
    const dm = await open("page");
    const ref = await composerRef();
    await dm("dm.composer.parentElement.remove()");
    await expect(page.type({ ref }, "lost")).rejects.toMatchObject({ code: "stale-ref" });
  }, hostTimeout(60_000));
});
