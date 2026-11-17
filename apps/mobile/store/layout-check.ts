// The phone app's layout as the browser draws it, at 440 x 956 in light and dark, on the throwaway fixture in stage.ts:
// message widths, the chat's composer and top bar, and nothing running off the side or over the composer. A rule that
// reads right in mobile.css but never reaches the screen fails here.
//
//   pnpm test:phone-layout
import { setTimeout as delay } from "node:timers/promises";
import { click, js, startStage, type Scheme, type Stage } from "./stage.ts";

const failures: string[] = [];
function check(where: string, what: string, ok: boolean, seen: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${where}: ${what}${ok ? "" : ` (saw ${JSON.stringify(seen)})`}`);
  if (!ok) failures.push(`${where}: ${what}`);
}

const VISIBLE = `(el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && Number(s.opacity) > 0.05 && !el.closest("[aria-hidden=true], [inert]"); }`;
const NAME = `(el) => (el.getAttribute("aria-label") || el.textContent || "").trim().toLowerCase()`;

/** wider than the screen: the page, and any scroller inside it that scrolls sideways */
const overflow = `(() => {
  const wide = [document.documentElement, document.body, ...document.querySelectorAll("*")].filter((el) => {
    const s = getComputedStyle(el);
    const scrolls = el === document.documentElement || el === document.body || /auto|scroll/.test(s.overflowX);
    return scrolls && el.scrollWidth > el.clientWidth + 1 && !el.closest("pre, table, [data-reply-table], [data-allow-scroll-x]") && el.clientWidth > 0;
  });
  return wide.slice(0, 3).map((el) => el.tagName + "." + String(el.className).slice(0, 60) + " " + el.scrollWidth + ">" + el.clientWidth);
})()`;

/** each message's bubble: whose, how long, its width as a share of the column, and how many lines it wraps to */
const BUBBLES = `[...document.querySelectorAll("[data-mobile-chat] [data-message-row]")].map((row) => {
  const bubble = row.querySelector("[data-chat-bubble]");
  if (!bubble) return null;
  const r = bubble.getBoundingClientRect(), s = getComputedStyle(bubble);
  const line = parseFloat(s.lineHeight) || 20, pad = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
  return { own: row.classList.contains("items-end"), chars: bubble.textContent.trim().length, width: r.width / row.getBoundingClientRect().width, lines: Math.round((r.height - pad) / line) };
}).filter(Boolean)`;
const LONG_OWN = "can you move friday's dinner to saturday, keep the same table for four, and tell everyone in the group chat";

async function chatScreen({ page, home, chat }: Stage, scheme: Scheme) {
  const where = `chat ${scheme}`;
  await home(scheme);
  await chat("Nova");
  const g = await page.evaluate(`(() => {
    const visible = ${VISIBLE}, name = ${NAME};
    const bubbles = ${BUBBLES};
    const composer = document.querySelector("[data-mobile-chat] [data-tour=composer]");
    const controls = [...composer.querySelectorAll("button, textarea, input")].filter(visible).map((el) => el.tagName === "BUTTON" ? name(el) : el.tagName.toLowerCase());
    const nav = [...document.querySelectorAll("[data-mobile-chat] nav button")].filter(visible).map(name);
    const c = composer.getBoundingClientRect();
    const covered = [];
    for (const fx of [0.08, 0.3, 0.5, 0.7, 0.92]) for (const fy of [0.25, 0.5, 0.75]) {
      const x = c.left + c.width * fx, y = c.top + c.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (hit && !composer.contains(hit)) covered.push(hit.tagName + "." + String(hit.className).slice(0, 50));
    }
    return { bubbles, controls, nav, covered, composerBottom: c.bottom, height: innerHeight };
  })()`);

  const long = (own: boolean) => g.bubbles.filter((b: any) => b.own === own && b.lines >= 2);
  const short = g.bubbles.filter((b: any) => b.chars <= 20);
  check(where, "a long bot reply wraps like a chat bubble, 60% to 85% of the column", long(false).length > 0 && long(false).every((b: any) => b.width >= 0.6 && b.width <= 0.86), long(false));
  check(where, "a short bubble fits its text on one line", short.length > 0 && short.every((b: any) => b.lines === 1 && b.width < 0.6), short);
  check(where, "the composer shows add, the message field and the microphone, nothing else", g.controls.length === 3 && /add|attach|\+/.test(g.controls[0]) && g.controls[1] === "textarea" && /dictat|voice|mic|speak/.test(g.controls[2]), g.controls);
  check(where, "the top bar has back, the name pill and the computer", g.nav.length === 3 && /back/.test(g.nav[0]) && /nova/.test(g.nav[1]) && /computer/.test(g.nav[2]), g.nav);
  check(where, "nothing covers the composer", g.covered.length === 0, g.covered);
  check(where, "the composer sits on the screen", g.composerBottom <= g.height + 1, [g.composerBottom, g.height]);
  check(where, "nothing runs off the side", (await page.evaluate(overflow)).length === 0, await page.evaluate(overflow));

  await page.evaluate(`(() => {
    const field = document.querySelector("[data-mobile-chat] [data-tour=composer] textarea");
    field.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(field, ${js(LONG_OWN)});
    field.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await delay(500);
  const typed = await page.evaluate(`[...document.querySelector("[data-mobile-chat] [data-tour=composer]").querySelectorAll("button")].filter(${VISIBLE}).map(${NAME})`);
  check(where, "typing brings up send", typed.some((n: string) => /send/.test(n)), typed);

  await click(page, `document.querySelector("[data-mobile-chat] [data-composer-send]")`);
  await page.until(`[...document.querySelectorAll("[data-mobile-chat] [data-message-row].items-end")].some((row) => row.textContent.includes(${js(LONG_OWN.slice(0, 30))}))`, 10_000);
  await delay(600);
  const sent = (await page.evaluate(BUBBLES)).filter((b: any) => b.own && b.chars >= LONG_OWN.length);
  check(where, "a long own message stops between 60% and 85% of the column", sent.length > 0 && sent.every((b: any) => b.lines >= 2 && b.width > 0.6 && b.width <= 0.851), sent);
}

async function homeScreen({ page, home }: Stage, scheme: Scheme) {
  await home(scheme);
  check(`home ${scheme}`, "nothing runs off the side", (await page.evaluate(overflow)).length === 0, await page.evaluate(overflow));
}

async function sheet({ page, home, chat }: Stage, scheme: Scheme) {
  const where = `profile sheet ${scheme}`;
  await home(scheme);
  await chat("Nova");
  await click(page, `document.querySelector('[data-mobile-chat] nav button[aria-label*="profile" i]')`);
  await page.until(`[...document.querySelectorAll("[role=dialog]")].some(${VISIBLE})`, 10_000).catch(() => {});
  await delay(800);
  const g = await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll("[role=dialog]")].filter(${VISIBLE}).at(-1);
    const r = dialog?.getBoundingClientRect();
    return { open: Boolean(dialog), left: r?.left, right: r?.right, width: innerWidth, named: Boolean(dialog?.textContent.includes(${js("Nova")})) };
  })()`);
  check(where, "the sheet opens with the bot's name", g.open && g.named, g);
  check(where, "the sheet fits the screen's width", g.open && g.left >= -1 && g.right <= g.width + 1, g);
  check(where, "nothing runs off the side", (await page.evaluate(overflow)).length === 0, await page.evaluate(overflow));
}

const started = Date.now();
const stage = await startStage();
try {
  for (const scheme of ["light", "dark"] as const) {
    for (const screen of [chatScreen, homeScreen, sheet]) {
      try { await screen(stage, scheme); } catch (error) { check(`${screen.name} ${scheme}`, "draws", false, (error as Error).message.split("\n")[0]); }
    }
  }
} finally {
  await stage.stop();
}
console.log(`\n${failures.length ? `${failures.length} failed` : "all held"} in ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(failures.length ? 1 : 0);
