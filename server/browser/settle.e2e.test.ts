// Page reads on real Chrome wait out loading placeholders and a bot check that clears by itself.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "../testing/host-timeout.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import type { BrowserTarget } from "./service.ts";
import { startService, type RealService } from "./testing/real-service.ts";

const suite = CHROME ? describe : describe.skip;

suite("settled page reads on real Chrome", () => {
  let fx: FixtureServer;
  let real: RealService;
  let bots = 0;

  beforeAll(async () => {
    fx = await FixtureServer.start();
    real = await startService();
  }, hostTimeout(240_000));

  afterAll(async () => {
    await real?.close();
    await fx?.close();
  });

  const bot = (): BrowserTarget => ({ session: `settle-${++bots}`, key: `bot:settle-${bots}` });
  const page = (path: string, title: string, body: string) => fx.page(path, `<!doctype html><meta charset="utf-8"><title>${title}</title>${body}`);

  it("answers open with the content a skeleton turns into, not the skeleton", async () => {
    const url = page("/skeleton", "Order", `<div id="slot"><div class="skeleton-line" style="height:20px;width:200px;background:#eee"></div></div>
      <script>setTimeout(() => { document.querySelector("#slot").innerHTML = '<p>Total: $19.99</p><button>Pay</button>'; }, 700);</script>`);
    const started = Date.now();
    const text = real.text(await real.call(bot(), "agent_browser_open", { url }));
    expect(text).toContain("Total: $19.99");
    expect(text).toContain(`button "Pay"`);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("says when placeholders were still there after 2 s", async () => {
    const url = page("/forever", "Feed", `<a href="/">home</a><div aria-busy="true" style="height:40px">loading</div>`);
    const text = real.text(await real.call(bot(), "agent_browser_open", { url }));
    expect(text).toMatch(/Parts of the page were still loading after 2 s/);
  });

  it("waits out a check that clears by itself and answers with the site behind it", async () => {
    page("/inside", "Store", `<h1>Store front</h1><a href="/cart">Cart</a>`);
    const url = page("/gate", "Just a moment...", `<div id="challenge-running">Checking if the site connection is secure</div>
      <script>setTimeout(() => location.replace("/inside"), 2_500);</script>`);
    const started = Date.now();
    const text = real.text(await real.call(bot(), "agent_browser_open", { url }));
    expect(text).toMatch(/The site ran a Cloudflare bot check first; it cleared by itself after [23] s\./);
    expect(text).toContain(`heading "Store front"`);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("does not wait on a check a person must answer, and says not to solve it", async () => {
    const url = page("/hold", "Access to this page has been denied", `<p>Press and hold to confirm you are a human</p><div id="px-captcha" style="width:300px;height:50px"></div>`);
    const started = Date.now();
    const text = real.text(await real.call(bot(), "agent_browser_open", { url }));
    expect(text).toMatch(/Bot check: needs you \(PerimeterX\)\. The site still shows a PerimeterX bot check after 0 s\. Never click it, solve it or try to hide that you are a bot/);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("closes a cookie banner on the bot's tab by rejecting, never by accepting", async () => {
    const banner = (choices: string) => `<h1>News</h1><div id="onetrust-banner-sdk" style="position:fixed;bottom:0;padding:20px;background:#eee">
      <p>We use cookies to improve your experience.</p>${choices}</div>`;
    const url = page("/cookies", "News", banner(`<button onclick="document.title='accepted'">Accept all cookies</button><button onclick="document.title='rejected'">Reject all</button>`));
    const target = bot();
    const text = real.text(await real.call(target, "agent_browser_open", { url }));
    expect(text).toContain(`A cookie banner was closed by choosing "Reject all"; cookies were not accepted.`);
    expect(await real.read<string>(target, "document.title")).toBe("rejected");
    // a banner with no way to refuse is left for the bot to read, and a later read of that page does not try again
    const only = page("/cookies-accept-only", "Shop", banner(`<button onclick="document.title='accepted'">Accept all</button><button onclick="document.title='settings'">Manage settings</button>`));
    expect(real.text(await real.call(target, "agent_browser_open", { url: only }))).not.toContain("cookie banner was closed");
    expect(await real.read<string>(target, "document.title")).toBe("Shop");
    // a page's own "Decline" outside a banner is never pressed
    const own = page("/invite", "Invite", `<p>Join the team?</p><button onclick="document.title='declined'">Decline</button>`);
    await real.call(target, "agent_browser_open", { url: own });
    expect(await real.read<string>(target, "document.title")).toBe("Invite");
  });

  it("answers a cookie banner that shows after the page loaded on the next read, and none on a tab a person opened", async () => {
    const late = page("/late-cookies", "Late", `<h1>Late</h1><script>setTimeout(() => { const b = document.createElement("div"); b.id = "CybotCookiebotDialog";
      b.innerHTML = '<p>This website uses cookies</p><button onclick="document.title=\\'necessary\\'">Use necessary cookies only</button><button onclick="document.title=\\'all\\'">Allow all</button>';
      document.body.append(b); }, 2_500);</script>`);
    const target = bot();
    expect(real.text(await real.call(target, "agent_browser_open", { url: late }))).not.toContain("cookie banner");
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(real.text(await real.call(target, "agent_browser_snapshot"))).toContain(`choosing "Use necessary cookies only"`);
    expect(await real.read<string>(target, "document.title")).toBe("necessary");

    const theirs = page("/their-cookies", "Theirs", `<div class="cookie-consent"><p>Cookies?</p><button onclick="document.title='rejected'">Reject all</button></div>`);
    const viewer = await real.service.attachViewer(target, { owner: "local-owner", canOperate: true, maxWidth: 1280, maxHeight: 800, together: true }, (output) => {
      if (output.type === "frame") output.ack();
    });
    await viewer.input({ type: "tabNew", url: theirs });
    const opened = real.service.profile(target).tabs.list().at(-1)!;
    await opened.page.lifecycle.waitFor("load", { timeoutMs: 10_000 }).catch(() => undefined);
    expect(real.text(await real.call(target, "agent_browser_snapshot", { tab: opened.id }))).not.toContain("cookie banner");
    expect(await opened.page.evaluate("document.title")).toBe("Theirs");
    await viewer.close();
  });

  it("finds the checkbox of a check widget inside its frame, in the page's viewport", async () => {
    const widget = fx.page("/widget-frame", `<!doctype html><title>w</title><body style="margin:0"><input type="checkbox" style="margin:20px">`);
    const target = bot();
    await real.call(target, "agent_browser_open", { url: page("/form-with-widget", "Sign up", `<div style="height:300px"></div><iframe id="w" src="${widget}" style="position:absolute;left:100px;top:300px;width:300px;height:65px;border:0"></iframe>`) });
    const tab = real.service.profile(target).agentTab()!;
    const frame = tab.page.frames.all().find((candidate) => candidate.url === widget)!;
    // the widget's own frames come from its vendor; the measuring is the same for any frame named like one
    frame.url = "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/normal";
    const { checkboxPoint } = await import("./cdp/checkbox.ts");
    expect(await checkboxPoint(tab.page.frames)).toEqual({ x: 128, y: 332.5 });
  });

  it("reads a page that settled the same way", async () => {
    const url = page("/late", "Late", `<a href="/">home</a><div id="slot"><span class="spinner">…</span></div>
      <script>setTimeout(() => { document.querySelector("#slot").textContent = "Delivered on Monday"; }, 600);</script>`);
    const text = real.text(await real.call(bot(), "agent_browser_read", { url }));
    expect(text).toContain("Delivered on Monday");
  });
});
