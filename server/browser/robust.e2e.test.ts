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

  it("sets a slider through fill, by arrow keys on an ARIA slider and directly on a range input", async () => {
    const target = bot();
    const opened = real.text(await real.call(target, "agent_browser_open", { url: page("/slider", `<div id="s" role="slider" tabindex="0" aria-label="Max price" aria-valuemin="0" aria-valuemax="2000" aria-valuenow="2000"></div>
      <input type="range" id="r" aria-label="Volume" min="0" max="10" value="2" oninput="document.title='volume ' + this.value">
      <script>const s = document.getElementById("s"); s.addEventListener("keydown", (e) => { const d = { ArrowRight: 50, ArrowLeft: -50 }[e.key]; if (d) s.setAttribute("aria-valuenow", Math.max(0, Math.min(2000, Number(s.getAttribute("aria-valuenow")) + d))); });</script>`) }));
    await real.call(target, "agent_browser_fill", { ref: refOf(opened, "slider", "Max price"), text: "$750" });
    expect(await real.read<string>(target, "document.getElementById('s').getAttribute('aria-valuenow')")).toBe("750");
    await real.call(target, "agent_browser_fill", { ref: refOf(opened, "slider", "Volume"), text: "7" });
    expect(await real.read<string>(target, "document.title")).toBe("volume 7");
  });

  it("fills the field inside the box or label it was given, and says why a read-only field takes no text", async () => {
    const target = bot();
    await real.call(target, "agent_browser_open", { url: page("/fields", `<div class="wrap" role="group" aria-label="Search box"><span>🔎</span><input id="q"></div>
      <label>Check in <input id="d" readonly></label>`) });
    await real.call(target, "agent_browser_fill", { selector: ".wrap", text: "lisbon" });
    expect(await real.read<string>(target, "document.getElementById('q').value")).toBe("lisbon");
    const refused = await real.call(target, "agent_browser_fill", { selector: "#d", text: "2027-03-14" });
    expect(real.text(refused)).toMatch(/read-only.*Click it and choose the value there/u);
  });

  it("puts a file into the hidden input behind a dropzone label", async () => {
    const target = bot();
    const file = `${real.dataDir}/receipt.txt`;
    (await import("node:fs")).writeFileSync(file, "receipt");
    await real.call(target, "agent_browser_open", { url: page("/drop", `<label class="drop">Drop a receipt or browse<input type="file" hidden onchange="document.title=this.files[0].name"></label>`) });
    const put = await real.call(target, "agent_browser_upload", { selector: ".drop", files: [file] });
    expect(put.isError).toBeUndefined();
    expect(await real.read<string>(target, "document.title")).toBe("receipt.txt");
  });

  it("scrolls a virtual list inside an app that does not scroll until a name shows, then gives its row a ref", async () => {
    const target = bot();
    await real.call(target, "agent_browser_open", { url: page("/virtual", `<div style="display:flex;height:100vh"><div id="l" style="width:300px;overflow:auto;position:relative"><div id="s" style="position:relative"></div></div><main style="flex:1">pane</main></div>
      <script>const names = Array.from({ length: 300 }, (_, i) => i === 240 ? "Priya Raman" : "Person " + i), list = document.getElementById("l"), spacer = document.getElementById("s");
      spacer.style.height = names.length * 50 + "px";
      const draw = () => { const first = Math.floor(list.scrollTop / 50); spacer.innerHTML = ""; for (let i = first; i < Math.min(names.length, first + 20); i++) { const row = document.createElement("div"); row.style = "position:absolute;top:" + i * 50 + "px;height:50px;cursor:pointer"; row.textContent = names[i]; row.onclick = () => document.title = names[i]; spacer.appendChild(row); } };
      list.addEventListener("scroll", draw); draw();</script>`) });
    const found = real.text(await real.call(target, "agent_browser_scroll", { toText: "Priya Raman", dy: 1500 }));
    expect(found).toMatch(/"Priya Raman" shows on the page now/u);
    expect(found).toMatch(/- generic \[ref=e\d+\] \[cursor=pointer\]: Priya Raman\n/u);
    await real.call(target, "agent_browser_click", { text: "Priya Raman" });
    expect(await real.read<string>(target, "document.title")).toBe("Priya Raman");
  });

  it("takes :has-text and role words written as CSS, and answers an ambiguous selector with refs to choose from", async () => {
    const target = bot();
    await real.call(target, "agent_browser_open", { url: page("/feed", `<article><p>Morning run</p><button aria-label="Like" onclick="document.title='liked run'">♡</button></article>
      <article><p>First ceramics class</p><button aria-label="Like" onclick="document.title='liked ceramics'">♡</button></article><div role="textbox" contenteditable="true" aria-label="Reply"></div>`) });
    await real.call(target, "agent_browser_click", { selector: "article:has-text(\"ceramics\") [aria-label=\"Like\"]" });
    expect(await real.read<string>(target, "document.title")).toBe("liked ceramics");
    expect((await real.call(target, "agent_browser_type", { selector: "textbox[name=\"Reply\"]", text: "nice" })).isError).toBeUndefined();
    const ambiguous = await real.call(target, "agent_browser_click", { selector: "[aria-label=Like]" });
    expect(ambiguous.isError).toBe(true);
    expect(real.text(ambiguous)).toMatch(/matches 2 elements, so nothing was done\. They: e\d+ <button> "Like"; e\d+ <button> "Like"\. Pass the ref/u);
    const second = /; (e\d+) <button>/u.exec(real.text(ambiguous))![1]!;
    await real.call(target, "agent_browser_click", { ref: second });
    expect(await real.read<string>(target, "document.title")).toBe("liked ceramics");
  });

  it("does not wait on loading placeholders behind a modal wall, and marks the wall modal", async () => {
    const { value, ms } = await timed(() => real.call(bot(), "agent_browser_open", { url: page("/wall", `<main aria-busy="true" style="height:200px">Loading stories…</main>
      <div role="dialog" aria-modal="true" aria-label="Your privacy" style="position:fixed;inset:0;background:#000a"><button>Manage choices</button></div>`) }));
    expect(real.text(value)).toMatch(/dialog "Your privacy" \[modal\]/u);
    expect(real.text(value)).not.toMatch(/still loading/u);
    expect(ms).toBeLessThan(1_800);
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
