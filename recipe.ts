// Re-shoot: REPO=<checkout> OUT=<dir> PLANT_SCRIPT=<plant.sh that copies an invented Grok Bot profile into a temporary home> node --experimental-strip-types recipe.ts
// Isolated fake-engine fixture as the desktop app's own server, the invented Grok Bot profile planted in its temporary
// home, Settings → Bring in from other apps → Grok Bot → Bring in, then About me, the first bot's note and Fen's
// memory read back; About me and the note photographed at 2x.
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
    const rect = await page.evaluate(`(() => { const r = (${selector})?.getBoundingClientRect(); return r && { x: r.x, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
    if (!rect) throw new Error(`no ${name}`);
    const { data } = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...rect, scale: 2 } });
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
  result.line = await page.evaluate(`${SETTINGS}.querySelector('[data-bring-run]')?.innerText`);
  const api = async (path: string) => (await realFetch(`${fixture.info.url}${path}`, { headers: { origin: fixture.info.url, "x-dusk-desktop-owner": owner } })).json() as Promise<any>;
  result.aboutMe = (await api("/api/config")).profile?.aboutMe;
  // About me: Settings → General → the account row's About you form; the box is grown to its text for the photo
  await page.evaluate(`[...${SETTINGS}.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close')?.click()`);
  await page.until(`!(${SETTINGS})`);
  await page.evaluate(`document.querySelector('button[aria-label="App settings"]').click()`);
  await page.until(SETTINGS);
  await page.until(`document.querySelector('[data-settings-open="profile"]')`, 20_000);
  await page.evaluate(`document.querySelector('[data-settings-open="profile"]').click()`);
  await page.until(`document.querySelector('#profile-about-me')?.value.includes('Priya')`, 20_000);
  await page.evaluate(`(() => { const b = document.querySelector('#profile-about-me'); b.style.height = (b.scrollHeight + 4) + 'px'; b.scrollIntoView({ block: 'center' }); })()`);
  await delay(600);
  await shot("about-me", `document.querySelector('#profile-about-me').parentElement`);
  const bots = (await api("/api/bots")).bots as Array<{ id: string; name: string }>;
  result.bots = bots.map((b) => b.name);
  const fen = bots.find((b) => b.name === "Fen");
  if (fen) {
    result.fenTopics = await api(`/api/bots/${fen.id}/memory/file?path=${encodeURIComponent("memory/grok-bot-export-note.md")}`).catch(() => null);
  }
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await delay(500);
  await page.evaluate(`[...document.querySelectorAll('[role=dialog] button')].find((b) => b.getAttribute('aria-label') === 'Close')?.click()`);
  await delay(800);
  const openBot = async (name: string) => {
    await page.evaluate(`[...document.querySelectorAll('nav button, aside button, [role=button], button')].find((b) => b.innerText.trim().split('\n')[0] === ${JSON.stringify(name)} && !b.getAttribute('aria-label')?.startsWith('Actions'))?.click()`);
    await delay(1500);
  };
  await openBot("Fixture Starter");
  await page.until(`document.body.innerText.includes('I brought in what you had in Grok Bot')`, 20_000);
  const NOTE = `[...document.querySelectorAll('div')].filter((e) => e.innerText?.startsWith('I brought in what you had in Grok Bot') && e.innerText.includes('Ask me about any of it')).pop()`;
  result.note = await page.evaluate(`${NOTE}.innerText`);
  await shot("chat-note", NOTE);
  writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.PARK) { console.log(JSON.stringify({ previewUrl: ui.previewUrl, url: fixture.info.url, owner })); await new Promise(() => {}); }
} finally {
  page.close();
  await ui.close();
  await fixture.close();
}
