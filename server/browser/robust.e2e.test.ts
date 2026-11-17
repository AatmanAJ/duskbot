// The bot's clicks get past what covers their element as a person's would, give up quickly with a way forward when
// they cannot, and each action's answer names the controls it brought up, on real Chrome.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "../testing/host-timeout.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import type { BrowserTarget } from "./service.ts";
import { startService, type RealService } from "./testing/real-service.ts";

const suite = CHROME ? describe : describe.skip;

suite("robust browser actions on real Chrome", () => {
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

  const bot = (): BrowserTarget => ({ session: `robust-${++bots}`, key: `bot:robust-${bots}` });
  const page = (path: string, body: string) => fx.page(path, `<!doctype html><meta charset="utf-8"><title>${path.slice(1)}</title>${body}`);
  const refOf = (text: string, role: string, name: string) => new RegExp(`${role} "${name}"[^\\n]*\\[ref=(e\\d+)\\]`, "u").exec(text)?.[1] ?? "";
  const timed = async <T>(work: () => Promise<T>) => { const started = Date.now(); const value = await work(); return { value, ms: Date.now() - started }; };

  it("ticks a checkbox drawn by its label over a hidden input, at once", async () => {
    const target = bot();
    const opened = real.text(await real.call(target, "agent_browser_open", { url: page("/agree", `<label style="display:flex;gap:8px"><input type="checkbox" id="c" style="position:absolute;opacity:0;width:1px;height:1px"><span style="width:18px;height:18px;border:2px solid #555"></span> I agree</label>`) }));
    const { value, ms } = await timed(() => real.call(target, "agent_browser_check", { ref: refOf(opened, "checkbox", "I agree") }));
    expect(real.text(value)).toContain("Checked.");
    expect(ms).toBeLessThan(2_000);
    expect(await real.read<boolean>(target, "document.getElementById('c').checked")).toBe(true);
  });

  it("clicks a button a sticky header would hide once it scrolls the button clear of it", async () => {
    const target = bot();
    const opened = real.text(await real.call(target, "agent_browser_open", { url: page("/sticky", `<header style="position:sticky;top:0;height:150px;background:#111;color:#fff;z-index:2">Top</header>
      <div style="height:2000px"></div><button onclick="document.title='hit'">Far</button><div style="height:60px"></div>
      <script>addEventListener("scroll", () => {}, { passive: true })</script>`) }));
    await real.call(target, "agent_browser_eval", { expression: "(scrollTo(0, document.querySelector('button').getBoundingClientRect().top + scrollY - 20), true)" });
    const clicked = await real.call(target, "agent_browser_click", { ref: refOf(opened, "button", "Far") });
    expect(clicked.isError).toBeUndefined();
    expect(await real.read<string>(target, "document.title")).toBe("hit");
  });

  it("says within seconds that a fixed bar stays over the button and names the button that closes it", async () => {
    const target = bot();
    const opened = real.text(await real.call(target, "agent_browser_open", { url: page("/bar", `<div style="height:1500px"></div><button onclick="document.title='marked'">Mark all as read</button>
      <div style="position:fixed;left:0;right:0;bottom:0;height:100px;background:#4f46e5;z-index:9"><span>Chat with us</span><button aria-label="Close chat banner" onclick="this.parentElement.remove()">✕</button></div>`) }));
    const { value, ms } = await timed(() => real.call(target, "agent_browser_click", { ref: refOf(opened, "button", "Mark all as read") }));
    expect(value.isError).toBe(true);
    expect(real.text(value)).toMatch(/stays fixed on the screen.*Close it first: it has a button named "Close chat banner"/u);
    expect(ms).toBeLessThan(6_000);
    await real.call(target, "agent_browser_click", { selector: "role=button[name=\"Close chat banner\"]" });
    expect((await real.call(target, "agent_browser_click", { ref: refOf(opened, "button", "Mark all as read") })).isError).toBeUndefined();
    expect(await real.read<string>(target, "document.title")).toBe("marked");
  });

  it("says within seconds that a button stays disabled, and what to look at", async () => {
    const target = bot();
    const opened = real.text(await real.call(target, "agent_browser_open", { url: page("/disabled", `<button disabled>Confirm</button>`) }));
    const { value, ms } = await timed(() => real.call(target, "agent_browser_click", { ref: refOf(opened, "button", "Confirm") }));
    expect(real.text(value)).toMatch(/disabled\. Something on the page has to happen first/u);
    expect(ms).toBeLessThan(6_000);
  });

  it("answers a click that opens a dialog with the dialog's controls and their refs, which act at once", async () => {
    const target = bot();
    const opened = real.text(await real.call(target, "agent_browser_open", { url: page("/compose", `<button onclick="document.getElementById('d').hidden=false">Compose</button>
      <div id="d" role="dialog" aria-label="New Message" hidden><input aria-label="To"><button onclick="document.title='sent to ' + this.parentElement.querySelector('input').value">Send</button></div>`) }));
    const clicked = real.text(await real.call(target, "agent_browser_click", { ref: refOf(opened, "button", "Compose") }));
    expect(clicked).toMatch(/New on the page, with refs you can act on now:\n- dialog "New Message":\n {2}- textbox "To" \[ref=e\d+\]\n {2}- button "Send" \[ref=e\d+\]/u);
    await real.call(target, "agent_browser_fill", { ref: refOf(clicked, "textbox", "To"), text: "sam@acme.test" });
    await real.call(target, "agent_browser_click", { ref: refOf(clicked, "button", "Send") });
    expect(await real.read<string>(target, "document.title")).toBe("sent to sam@acme.test");
  });

  it("answers a click that moves to another page with that page's snapshot", async () => {
    const target = bot();
    const next = page("/next", `<h1>Orders</h1><button>Track order</button>`);
    const opened = real.text(await real.call(target, "agent_browser_open", { url: page("/start", `<a href="${next}">Your orders</a>`) }));
    const clicked = real.text(await real.call(target, "agent_browser_click", { ref: refOf(opened, "link", "Your orders") }));
    expect(clicked).toMatch(/The page is now .*\/next\. Its snapshot, with current refs to act on:/u);
    expect(clicked).toMatch(/button "Track order" \[ref=e\d+\]/u);
  });
});
