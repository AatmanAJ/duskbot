import type { Item, LabProps } from "@lab/types";
import { fragment, SiteFrame, type SiteLook } from "./kit/site";
import { realReveal, reveal } from "./kit/site-fx";

const frame = (html: string, width: number, height: number, frameCss: string) => (look: SiteLook) => (p: LabProps) =>
  <SiteFrame {...p} html={html} width={width} height={height} look={look} frameCss={frameCss} />;

/* how it works */
const how = frame(fragment("section.how"), 680, 780, `.how { padding: 40px 0 40px; min-height: 780px; } .how h2.big { font-size: 40px; }`);

export const siteHow: Item = {
  id: "site-how",
  title: "how it works pixel cards",
  surface: "site home",
  height: 330,
  loopMs: 3200,
  notes: {
    original: "motion kit: the list reveals when met, children rise 24px and fade on a spring (.55s, bounce .08), 60ms apart. (on the page it waits for the first scroll.)",
    a: "cards rise 10px in two pixel steps with a 160ms fade, 45ms apart. nothing else moves.",
    b: "each card uncovers from the bottom in 4 stepped frames (220ms), 70ms apart; then the shapes in 'make a bot' hop one after another, 70ms apart.",
  },
  Original: how(realReveal),
  A: how(reveal(".steps > li", "rise", 45)),
  B: how(reveal(".steps > li", "wipe", 70, `
    await lab.wait(560);
    for (const b of document.querySelectorAll('.shapes svg.bot')) { if (!lab.reduced) window.duskBots.react(b, 'hop'); await lab.wait(70); }`)),
};

/* a day with your bots */
const day = frame(fragment("section.day"), 960, 720, `
  .day-head { padding: 26px 24px 22px; } .day-head p { font-size: 16px; }
  .slots { grid-template-columns: repeat(5, minmax(0, 1fr)) !important; min-height: 560px; }
  .slot, .slot.night { grid-column: auto !important; padding: 24px 10px; min-height: 0; }
  .slot time { font-size: 34px; }`);

export const siteDay: Item = {
  id: "site-day",
  title: "a day with your bots, coloured slots",
  surface: "site home",
  height: 230,
  loopMs: 3600,
  notes: {
    original: "motion kit: the five slots rise 24px and fade on a spring (.55s, bounce .08), 90ms apart.",
    a: "slots rise 10px in two pixel steps with a 160ms fade, 70ms apart.",
    b: "the day passes: each slot's sky uncovers from the bottom in 4 stepped frames, 140ms apart, and its time scrambles in the pixel font (a new digit every 55ms) before it settles (scramble recipe rebuilt).",
  },
  Original: day(realReveal),
  A: day(reveal(".slots > li", "rise", 70)),
  B: day(reveal(".slots > li", "wipe", 140, `
    if (lab.reduced) return;
    document.querySelectorAll('.slot time').forEach((t, k) => {
      const real = t.textContent, digits = '0123456789';
      let n = 0;
      t.textContent = real.replace(/\\d/g, '0');
      setTimeout(() => {
        const id = setInterval(() => {
          n += 1;
          if (n > 4) { clearInterval(id); t.textContent = real; return; }
          t.textContent = real.replace(/\\d/g, () => digits[Math.floor(Math.random() * 10)]);
        }, 55);
      }, k * 140);
    });`)),
};

/* close the laptop: the lid side on its own */
const lidHtml = fragment(".lid-side");
const lid = frame(lidHtml, 560, 640, `.half { min-height: 640px; padding: 40px 24px 30px; } .cap { margin-top: 18px; }`);
const toggleDemo = `await lab.wait(900); document.querySelector('[data-lid-btn]').click(); await lab.wait(1800); document.querySelector('[data-lid-btn]').click();`;
const COPY = `const COPY = {
  open: ['close the lid', 'your computer, lid open', 'bots on your own computer work while it is awake. close the lid and they rest until it wakes.'],
  shut: ['open the lid', 'your computer, lid shut', 'bots on your own computer rest while it sleeps, and pick up where they left off when it wakes.'],
};`;

const lidA: SiteLook = {
  css: `
    .lid-side .lap { display: block !important; transition: opacity 150ms steps(3, jump-end); }
    .lid-side[data-lid="closed"] .lap.open, .lid-side[data-lid="open"] .lap.shut { opacity: 0; }
    .cap h3, .cap p { transition: opacity 120ms steps(2, jump-end), translate 120ms steps(2, jump-end); }
    .cap.ml-swap h3, .cap.ml-swap p { opacity: 0; translate: 0 5px; transition: none; }
  `,
  run: `(async (lab) => {
    ${COPY}
    const side = document.querySelector('[data-lid]'), btn = side.querySelector('[data-lid-btn]'), cap = side.querySelector('.cap'), crew = side.querySelector('.bs');
    window.duskBots.state(crew, 'asleep');
    btn.addEventListener('click', () => {
      const open = side.dataset.lid !== 'open', c = COPY[open ? 'open' : 'shut'];
      side.dataset.lid = open ? 'open' : 'closed'; btn.setAttribute('aria-pressed', open); btn.textContent = c[0];
      cap.classList.add('ml-swap'); cap.querySelector('h3').textContent = c[1]; cap.querySelector('p').textContent = c[2];
      requestAnimationFrame(() => requestAnimationFrame(() => cap.classList.remove('ml-swap')));
      window.duskBots.state(crew, open ? 'idle' : 'asleep');
      if (open && !lab.reduced) window.duskBots.react(crew, 'hop');
    });
    ${toggleDemo}
  })`,
};

const lidB: SiteLook = {
  css: `
    .lid-side .lap { display: block !important; }
    .lid-side .lap.open { clip-path: inset(100% 0 0 0); transition: clip-path 200ms steps(4, jump-end); }
    .lid-side[data-lid="open"] .lap.open { clip-path: inset(0 0 0 0); }
    .lid-side .lap.shut { transition: opacity 80ms steps(2, jump-end), translate 80ms steps(2, jump-end); }
    .lid-side[data-lid="open"] .lap.shut { opacity: 0; translate: 0 10px; }
    .lid-side[data-lid="open"] .lap.open { transition-delay: 60ms; }
    .lid-side .snore { display: inline-block; transition: opacity 240ms steps(3, jump-end), translate 240ms steps(3, jump-end); }
    .lid-side[data-lid="open"] .snore { visibility: visible !important; opacity: 0; translate: 0 -15px; animation: none; }
    .cap h3, .cap p { transition: opacity 160ms steps(2, jump-end), translate 160ms steps(2, jump-end); }
    .cap.ml-swap h3, .cap.ml-swap p { opacity: 0; translate: 0 10px; transition: none; }
    .cap.ml-swap p { translate: 0 15px; }
  `,
  run: `(async (lab) => {
    ${COPY}
    const side = document.querySelector('[data-lid]'), btn = side.querySelector('[data-lid-btn]'), cap = side.querySelector('.cap');
    const bots = [...side.querySelectorAll('.bs svg.bot')];
    bots.forEach((b) => window.duskBots.state(b, 'asleep'));
    btn.addEventListener('click', async () => {
      const open = side.dataset.lid !== 'open', c = COPY[open ? 'open' : 'shut'];
      side.dataset.lid = open ? 'open' : 'closed'; btn.setAttribute('aria-pressed', open); btn.textContent = c[0];
      cap.classList.add('ml-swap'); cap.querySelector('h3').textContent = c[1]; cap.querySelector('p').textContent = c[2];
      requestAnimationFrame(() => requestAnimationFrame(() => cap.classList.remove('ml-swap')));
      for (const b of bots) {
        window.duskBots.state(b, open ? 'waking' : 'asleep');
        if (open && !lab.reduced) setTimeout(() => { window.duskBots.state(b, 'idle'); window.duskBots.react(b, 'hop'); }, 260);
        await lab.wait(open ? 90 : 0);
      }
    });
    ${toggleDemo}
  })`,
};

export const siteLid: Item = {
  id: "site-lid",
  title: "close the laptop, lid toggle",
  surface: "site home",
  height: 330,
  loopMs: 3600,
  notes: {
    original: "home.js: the two pictures swap with display (a hard cut); caption and button text swap instantly; the bots go idle and hop when the lid opens. click the button.",
    a: "pictures crossfade in 3 stepped frames (150ms); the caption steps up 5px as it changes (2 frames, 120ms); same bot hop.",
    b: "the screen rises out of the lid in 4 stepped frames (200ms) as the shut laptop drops away; the z's drift up and out in 3 steps; the bots wake one by one, 90ms apart, then hop; caption steps up 10/15px.",
  },
  Original: lid({ real: true, run: `(async (lab) => { ${toggleDemo} })` }),
  A: lid(lidA),
  B: lid(lidB),
};

/* collectible bot cards */
const cardsHtml = fragment("section.team .cards", (el) => [...el.children].slice(2).forEach((c) => c.remove()));
const cards = frame(cardsHtml, 640, 400, `
  body { background: #90e4fc; padding: 40px 24px 0; }
  .cards { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; margin: 0; }`);
const hoverDemo = (fx: string, byPointer = true) => `(async (lab) => {
  const cs = [...document.querySelectorAll('.tc')];
  const on = (c, demo) => { c.classList.add('ml-hover'); if (demo || ${byPointer}) { ${fx} } };
  const off = (c) => c.classList.remove('ml-hover');
  cs.forEach((c) => { c.addEventListener('pointerenter', () => on(c)); c.addEventListener('pointerleave', () => off(c)); });
  await lab.wait(700); on(cs[0], true); await lab.wait(1100); off(cs[0]); on(cs[1], true); await lab.wait(1100); off(cs[1]);
})`;

export const siteCards: Item = {
  id: "site-cards",
  title: "collectible bot cards, hover",
  surface: "site home",
  height: 200,
  loopMs: 3400,
  notes: {
    original: "home.css + home.js: a hovered card lifts 4px, 250ms ease-out (0.23,1,0.32,1), and its bot hops. hover a card.",
    a: "lift snaps to the pixel grid: 5px in two steps, 120ms each way; the bot hops.",
    b: "lifts 10px in two steps; a pixel shine crosses the card's top band in 6 stepped frames (300ms), once per hover; the bot boings.",
  },
  Original: cards({ real: true, css: `.tc.ml-hover { translate: 0 -4px; }`, run: hoverDemo(`if (!lab.reduced) window.duskBots.react(c, 'hop');`, false) }),
  A: cards({
    css: `.tc { transition: translate 120ms steps(2, jump-end) !important; } .tc.ml-hover, .tc:hover { translate: 0 -5px !important; }`,
    run: hoverDemo(`if (!lab.reduced) window.duskBots.react(c, 'hop');`),
  }),
  B: cards({
    css: `
      .tc { transition: translate 120ms steps(2, jump-end) !important; } .tc.ml-hover, .tc:hover { translate: 0 -10px !important; }
      .tc .top { overflow: hidden; }
      .tc .top::after { content: ""; position: absolute; top: 0; bottom: 0; left: -40px; width: 30px; background: rgb(255 255 255 / .55);
        box-shadow: 15px 0 0 rgb(255 255 255 / .3); translate: 0 0; }
      .tc.ml-hover .top::after { animation: ml-shine 300ms steps(6, jump-end) both; }
      @keyframes ml-shine { to { translate: calc(var(--w, 340px) + 80px) 0; } }
      @media (prefers-reduced-motion: reduce) { .tc.ml-hover .top::after { animation: none; } .tc, .tc.ml-hover { translate: none !important; } }`,
    run: hoverDemo(`c.querySelector('.top').style.setProperty('--w', c.offsetWidth + 'px'); if (!lab.reduced) window.duskBots.react(c, 'boing');`),
  }),
};

