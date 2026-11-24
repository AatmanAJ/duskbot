// Re-shoot: REPO=<checkout> OUT=<dir> PLANT_SCRIPT=<plant.sh that copies an invented Grok Bot profile into a temporary home> node --experimental-strip-types recipe.ts
// Isolated fake-engine fixture as the desktop app's own server, the invented Grok Bot profile planted in its temporary
// home, Settings → Bring in from other apps → Grok Bot → Bring in, then Fen's memory topic read back through
// the API and Fen's instructions photographed at 2x.
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const REPO = process.env.REPO!, OUT = process.env.OUT!;
mkdirSync(OUT, { recursive: true });
const { launchVerificationServer, verificationHome } = await import(`${REPO}/scripts/control-dusk.ts`);
const { mountPreview } = await import(`${REPO}/scripts/testing/preview-fixture.ts`);
const { openHeadlessChrome } = await import(`${REPO}/scripts/testing/headless-chrome.ts`);
const owner = randomBytes(32).toString("base64url");
const env = { ...process.env, DUSK_TEST_DESKTOP_OWNER_TOKEN: owner };
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => realFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-dusk-desktop-owner": owner } });
const fixture = await launchVerificationServer(env);
const home = verificationHome(env, fixture.info.dataDir);
execFileSync("zsh", [process.env.PLANT_SCRIPT!, home], { stdio: "inherit" });
const ui = await mountPreview(fixture, { entry: "/scripts/testing/bot-move-preview.tsx", route: "/__bot-move.html", title: "Isolated grok move", proxyHeaders: { "x-dusk-desktop-owner": owner }, hmr: false, logLevel: "silent" });
rmSync(join(OUT, ".chrome"), { recursive: true, force: true });
const page = await openHeadlessChrome(join(OUT, ".chrome"));
const result: Record<string, unknown> = {};
try {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
  await page.send("Page.navigate", { url: ui.previewUrl });
  await page.until(`document.querySelector('button[aria-label="App settings"]')`);
  await delay(1500);
  // the welcome, as a new person meets it: Get started, then the engine found on this computer
  const press = (text: string) => page.evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes(${JSON.stringify(text)}))?.click()`);
  await page.until(`[...document.querySelectorAll('button')].some((b) => b.innerText.includes('Get started'))`, 20_000);
  await press("Get started");
  await page.until(`[...document.querySelectorAll('button')].some((b) => b.innerText.includes('Use the Claude you'))`, 20_000);
  await press("Use the Claude you");
  await page.until(`![...document.querySelectorAll('button')].some((b) => b.innerText.includes('Use the Claude you'))`, 20_000);
  await delay(2500);
  const shot = async (name: string, selector: string) => {
    const rect = await page.evaluate(`(() => { const r = (${selector})?.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    if (!rect) throw new Error(`no ${name}`);
    const { data } = await page.send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 2 } });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  };
  const SETTINGS = `[...document.querySelectorAll('[role=dialog]')].find((d) => d.getAttribute('aria-label') === 'Settings')`;
  await page.evaluate(`document.querySelector('button[aria-label="App settings"]').click()`);
  await page.until(SETTINGS);
  await page.evaluate(`[...${SETTINGS}.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Start import').click()`);
  await page.until(`${SETTINGS}.querySelector('[data-bring-import="bots:grok-bot"]')`, 20_000);
  result.row = await page.evaluate(`${SETTINGS}.querySelector('[data-bring-find="bots:grok-bot"]').innerText`);
  await page.evaluate(`${SETTINGS}.querySelector('[data-bring-import="bots:grok-bot"]').click()`);
  await page.until(`${SETTINGS}.querySelector('[data-bring-find="bots:grok-bot"]')?.getAttribute('data-bring-state') === 'done'`, 60_000);
  await delay(800);
  writeFileSync(join(OUT, "full-after-bring.png"), Buffer.from((await page.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  result.overlays = await page.evaluate(`[...document.querySelectorAll('[role=dialog],[aria-modal]')].map((d) => (d.getAttribute('aria-label') || '') + ':' + d.innerText.slice(0, 120))`);
  result.line = await page.evaluate(`${SETTINGS}.querySelector('[data-bring-run]')?.innerText`);
  await shot("bring-result", `${SETTINGS}.querySelector('[data-import-section="bring"]')`);
  await page.evaluate(`[...${SETTINGS}.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close')?.click()`);
  await delay(800);
  const openBot = async (name: string) => {
    await page.evaluate(`[...document.querySelectorAll('nav button, aside button, [role=button], button')].find((b) => b.innerText.trim().split('\\n')[0] === ${JSON.stringify(name)} && !b.getAttribute('aria-label')?.startsWith('Actions'))?.click()`);
    await delay(1500);
  };
  await openBot("Fen");
  await page.evaluate(`void (document.querySelector('[data-panel-tab]') || document.querySelector('button[aria-label="Open Fen\\'s profile"]')?.click())`);
  await delay(1200);
  await page.evaluate(`document.querySelector('[data-panel-tab="advanced"]')?.click()`);
  await delay(1200);
  result.panel = await page.evaluate(`[...document.querySelectorAll('[data-panel-page]')].map((e) => e.getAttribute('data-panel-page'))`);
  writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
  await page.until(`document.querySelector('[data-panel-page="instructions"]')`, 20_000);
  await page.evaluate(`document.querySelector('[data-panel-page="instructions"]').click()`);
  await page.until(`document.querySelector('[data-panel-modal="instructions"] textarea')`, 20_000);
  await delay(800);
  result.soul = await page.evaluate(`document.querySelector('[data-panel-modal="instructions"] textarea').value`);
  // the Routines part of the instructions, scrolled into view in the box
  await page.evaluate(`(() => { const box = document.querySelector('[data-panel-modal="instructions"] textarea'); const css = getComputedStyle(box); const mirror = document.createElement('div'); for (const k of ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'paddingLeft', 'paddingRight', 'boxSizing']) mirror.style[k] = css[k]; mirror.style.width = box.clientWidth + 'px'; mirror.style.whiteSpace = 'pre-wrap'; mirror.style.overflowWrap = 'break-word'; mirror.style.position = 'absolute'; mirror.style.visibility = 'hidden'; mirror.textContent = box.value.slice(0, box.value.indexOf('## What you know')); document.body.append(mirror); box.scrollTop = mirror.offsetHeight; mirror.remove(); })()`);
  result.scroll = await page.evaluate(`(() => { const b = document.querySelector('[data-panel-modal="instructions"] textarea'); const out = []; for (let e = b; e; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 4) out.push([e.tagName, e.className.slice(0, 40), e.scrollHeight, e.clientHeight, e.scrollTop, getComputedStyle(e).overflowY]); return out; })()`);
  await delay(500);
  await shot("fen-instructions", `(() => { let e = document.querySelector('[data-panel-modal="instructions"] textarea'); while (e && e.getBoundingClientRect().height < 300) e = e.parentElement; return e; })()`);
  const get = async (path: string) => (await realFetch(`${fixture.info.url}${path}`, { headers: { origin: fixture.info.url, "x-dusk-desktop-owner": owner } })).json() as Promise<any>;
  const fen = ((await get("/api/bots")).bots as Array<{ id: string; name: string }>).find((b) => b.name === "Fen")!;
  result.fenNote = (await get(`/api/bots/${fen.id}/memory/file?path=${encodeURIComponent("memory/grok-bot-export-note.md")}`)).text ?? null;
  result.fenSoulKnow = String(result.soul).split("## What you know")[1]?.split("\n\n")[0];
  const res = await realFetch(`${fixture.info.url}/api/bots`, { headers: { origin: fixture.info.url, "x-dusk-desktop-owner": owner } });
  result.bots = ((await res.json()) as { bots: Array<{ id: string; name: string }> }).bots.map((b) => [b.id, b.name]);
  result.dataDir = fixture.info.dataDir;
  writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.PARK) { console.log(JSON.stringify({ previewUrl: ui.previewUrl, url: fixture.info.url, owner })); await new Promise(() => {}); }
} finally {
  page.close();
  await ui.close();
  await fixture.close();
}
