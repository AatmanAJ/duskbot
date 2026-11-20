// Photographs the phone app's real screens for the store listing at 1320 x 2868 (440 x 956 points at 3x), on the
// throwaway fixture in stage.ts.
//
//   node --experimental-strip-types apps/mobile/store/capture.ts [outDir]     (default ~/Desktop/code/omb-ref/store/raw)
//
// STORE_ONLY=<regex> takes only the matching shots. STORE_SCHEMES=light,dark takes every screen in each scheme, named
// <screen>-<scheme>.png, instead of the store set's own names and schemes.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { button, click, startStage, type Scheme, type Stage } from "./stage.ts";
import { ROOM } from "./team.mjs";

const out = process.argv[2] ?? join(homedir(), "Desktop/code/omb-ref/store/raw");
const only = process.env.STORE_ONLY ? new RegExp(process.env.STORE_ONLY) : null;
const schemes = process.env.STORE_SCHEMES?.split(",").map((one) => one.trim()) as Scheme[] | undefined;

type Screen = (stage: Stage, scheme: Scheme) => Promise<void>;

const SCREENS: Record<string, Screen> = {
  home: async ({ home }, scheme) => { await home(scheme); },
  "chat-nova": async ({ home, chat }, scheme) => { await home(scheme); await chat("Nova"); },
  "chat-pip": async ({ home, chat }, scheme) => { await home(scheme); await chat("Pip"); },
  "chat-echo": async ({ home, chat }, scheme) => { await home(scheme); await chat("Echo"); },
  room: async ({ page, home, chat }, scheme) => {
    await home(scheme);
    await chat(ROOM.name);
    await page.evaluate(`[...document.querySelectorAll("button")].find((el) => /skip for now/i.test(el.textContent))?.click()`);
    await delay(1200);
  },
  routines: async ({ page, home }, scheme) => {
    await home(scheme);
    await click(page, `document.querySelector('[aria-label^="you and settings" i]') ?? ${button("You")}`);
    await delay(900);
    await click(page, button("Routines"));
    await delay(1800);
  },
  apps: async ({ page, home }, scheme) => {
    await home(scheme);
    await click(page, `document.querySelector('[aria-label^="you and settings" i]')`);
    await delay(900);
    await click(page, button("Connected apps"));
    await delay(2500);
  },
  profile: async ({ page, home, chat }, scheme) => {
    await home(scheme);
    await chat("Nova");
    await click(page, `document.querySelector('[data-mobile-chat] nav button[aria-label*="profile" i]')`);
    await delay(1500);
  },
  pair: async ({ page, open }, scheme) => {
    await open(scheme, "&pair=1");
    await page.until(`document.body.textContent.includes("on your phone")`, 20_000);
    await delay(1200);
  },
};

/** the store set: [file name, screen, scheme] */
const STORE_SET: Array<[string, string, Scheme]> = [
  ["home", "home", "light"], ["chat-nova", "chat-nova", "light"], ["chat-pip", "chat-pip", "light"], ["chat-echo", "chat-echo", "light"],
  ["room", "room", "light"], ["routines-dark", "routines", "dark"], ["apps", "apps", "light"], ["home-dark", "home", "dark"],
  ["profile", "profile", "light"], ["pair", "pair", "dark"],
];

async function main() {
  mkdirSync(out, { recursive: true });
  const shots: Array<[string, string, Scheme]> = schemes
    ? Object.keys(SCREENS).flatMap((screen) => schemes.map((scheme): [string, string, Scheme] => [`${screen}-${scheme}`, screen, scheme]))
    : STORE_SET;
  const stage = await startStage();
  try {
    for (const [name, screen, scheme] of shots) {
      if (only && !only.test(name)) continue;
      try {
        await SCREENS[screen]!(stage, scheme);
        await stage.page.evaluate(`document.activeElement?.blur?.()`);
        await delay(600);
        writeFileSync(join(out, `${name}.png`), await stage.page.capture());
        console.log(`${out}/${name}.png`);
      } catch (error) { console.error(`${name}: ${(error as Error).message.split("\n")[0]}`); }
    }
  } finally {
    await stage.stop();
  }
}

await main();
process.exit(0);
