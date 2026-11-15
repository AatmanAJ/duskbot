import type { Item, LabProps } from "@lab/types";
import { fragment, SiteFrame, type SiteLook } from "./kit/site";

const frame = (html: string, width: number, height: number, frameCss: string) => (look: SiteLook) => (p: LabProps) =>
  <SiteFrame {...p} html={html} width={width} height={height} look={look} frameCss={frameCss} />;

/* pricing and the monthly / yearly toggle */
const pricing = frame(fragment("section.pricing", (el) => { el.querySelector("#free")?.remove(); el.querySelector(".fine")?.remove(); }), 720, 660, `
  .pricing { padding: 30px 0 30px; min-height: 660px; } .p-head h2 { font-size: 30px; }
  .plans { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; margin-top: 26px; gap: 14px; }`);
const billDemo = `await lab.wait(900); document.querySelector('[data-period="y"]').click(); await lab.wait(1700); document.querySelector('[data-period="m"]').click();`;
// the clip-path indicator and the copy swap, as home.js does them; `paint(n, from, to)` draws the new amount
const billing = (paint: string) => `(async (lab) => {
  const bill = document.querySelector('[data-bill]'), btns = [...bill.querySelectorAll('button')], ind = bill.querySelector('.seg-ind'), root = bill.closest('section');
  const place = () => { const b = btns.find((x) => x.getAttribute('aria-pressed') === 'true');
    ind.style.clipPath = 'inset(' + b.offsetTop + 'px ' + (bill.clientWidth - b.offsetLeft - b.offsetWidth) + 'px ' + (bill.clientHeight - b.offsetTop - b.offsetHeight) + 'px ' + b.offsetLeft + 'px)'; };
  const paint = ${paint};
  place(); bill.classList.add('is-on');
  root.querySelectorAll('.amt [data-m]').forEach((n) => paint(n, null, n.textContent));
  bill.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    btns.forEach((x) => x.setAttribute('aria-pressed', x === b)); place();
    const k = b.dataset.period;
    root.querySelectorAll('.amt [data-m]').forEach((n) => paint(n, n.dataset.now, n.dataset[k]));
    root.querySelectorAll('.per[data-m]').forEach((n) => { n.textContent = n.dataset[k]; n.classList.remove('ml-sw'); void n.offsetWidth; n.classList.add('ml-sw'); });
  });
  ${billDemo}
})`;
const rollPaint = `(n, from, to) => {
  n.dataset.now = to;
  const old = (from || '').padStart(to.length, ' ');
  n.replaceChildren(...[...to].map((c, i) => { const s = document.createElement('span'); s.textContent = c; if (from !== null && old[i] !== c) s.className = 'ml-r'; return s; }));
}`;
const drumPaint = `(n, from, to) => {
  n.dataset.now = to;
  if (!n.ml) {
    n.textContent = ''; n.ml = [];
    for (let i = 0; i < 3; i++) { const col = document.createElement('span'); col.className = 'ml-col'; const strip = document.createElement('span'); strip.className = 'ml-strip';
      strip.innerHTML = '0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9'; col.append(strip); n.append(col); n.ml.push({ col, strip, d: 0 }); }
    n.setAttribute('aria-label', to);
  }
  n.setAttribute('aria-label', to);
  const digits = to.padStart(3, ' ');
  n.ml.forEach((c, i) => {
    const ch = digits[i], on = ch !== ' ', d = on ? +ch : 0, steps = Math.max(1, Math.abs(d - c.d));
    c.col.classList.toggle('ml-off', !on);
    c.strip.style.transition = from === null || lab.reduced ? 'none' : 'translate ' + (steps * 40) + 'ms steps(' + steps + ', jump-end) ' + (i * 45) + 'ms';
    c.strip.style.translate = '0 ' + (-d) + 'em'; c.d = d;
  });
}`;

export const sitePricing: Item = {
  id: "site-pricing",
  title: "site pricing cards and monthly / yearly",
  surface: "site home",
  height: 270,
  loopMs: 3600,
  notes: {
    original: "home.js: the dark block is a clip-path cut, 300ms (0.77,0,0.175,1); prices count through every number on a spring (.5s, bounce .15); the 'a month' line swaps instantly.",
    a: "the block jumps across in 4 pixel steps (160ms); only the digits that change step up 10px in two frames; the line under the price fades in 2 steps (120ms).",
    b: "pixel odometer: each digit column turns one digit per 40ms frame, columns 45ms apart, a new column steps in from nothing; the block crosses in 4 steps (200ms); '2 months free' pops in 2 frames.",
  },
  Original: pricing({ real: true, run: `(async (lab) => { ${billDemo} })` }),
  A: pricing({
    css: `
      .seg-ind { transition: clip-path 160ms steps(4, jump-end); }
      .amt [data-m] > span { display: inline-block; }
      .ml-r { animation: ml-rise 120ms steps(2, jump-end) both; }
      @keyframes ml-rise { from { translate: 0 10px; opacity: .5; } }
      .ml-sw { animation: ml-fade 120ms steps(2, jump-end) both; }
      @keyframes ml-fade { from { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .seg-ind { transition: none; } .ml-r { animation: ml-fade 150ms linear both; } }`,
    run: billing(rollPaint),
  }),
  B: pricing({
    css: `
      .seg-ind { transition: clip-path 200ms steps(4, jump-end); }
      .amt [data-m] { display: inline-flex; }
      .ml-col { display: inline-block; height: 1em; line-height: 1; overflow: hidden; width: .6em; transition: width 80ms steps(2, jump-end); }
      .ml-col.ml-off { width: 0; }
      .ml-strip { display: block; text-align: center; }
      .amt { display: inline-flex; align-items: baseline; line-height: 1; }
      .seg button[aria-pressed="true"] em { animation: ml-pop 160ms steps(2, jump-end) both; }
      @keyframes ml-pop { from { scale: .8; } }
      .ml-sw { animation: ml-up 160ms steps(2, jump-end) both; }
      @keyframes ml-up { from { opacity: 0; translate: 0 5px; } }
      @media (prefers-reduced-motion: reduce) { .seg-ind, .ml-col { transition: none; } .seg button em, .ml-sw { animation: none; } }`,
    run: billing(drumPaint),
  }),
};

/* the approval card */
const ask = frame(fragment("figure.ask"), 600, 460, `body { background: #90e4fc; padding: 26px 24px; } .ask { margin: 0; }`);
const SAY = `const SAY = { yes: 'sent. juno is cheering. (a sample, nothing was sent)', no: 'okay. juno will hold it until you say so.', list: '1,204 people on the launch list. juno is still waiting.' };`;
const askDemo = `await lab.wait(1000); document.querySelector('[data-ans="list"]').click(); await lab.wait(1500); document.querySelector('[data-ans="yes"]').click();`;
const answer = (fx: string) => `(async (lab) => {
  ${SAY}
  const ask = document.querySelector('[data-ask]'), line = ask.querySelector('[data-ask-line]'), juno = ask.querySelector('.ask-head');
  ask.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ans]'); if (!b) return;
    const k = b.dataset.ans;
    ask.querySelectorAll('[data-ans]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    ask.classList.toggle('answered', k !== 'list');
    ${fx}
  });
  ${askDemo}
})`;

export const siteApproval: Item = {
  id: "site-approval",
  title: "approval card buttons",
  surface: "site home",
  height: 230,
  loopMs: 4000,
  notes: {
    original: "px.css + home.js: a press scales to .97 (160ms); the picked button fills at once; the line under swaps instantly; juno celebrates on yes.",
    a: "a press sinks 2px like a key (no scale); the picked fill steps in (2 frames, 120ms); the line steps up 5px as it changes; juno celebrates.",
    b: "yes turns into 'sent' with a pixel check, and 10 pixel squares burst from it in 6 stepped frames (420ms); the line's words land 40ms apart; juno boings and celebrates.",
  },
  Original: ask({ real: true, run: `(async (lab) => { ${askDemo} })` }),
  A: ask({
    css: `
      .btns .pxb { transition: background-color 120ms steps(2, jump-end), translate 60ms steps(1, jump-end) !important; }
      .btns .pxb:active { scale: 1; translate: 0 2px; }
      [data-ask-line].ml-sw { animation: ml-up 120ms steps(2, jump-end) both; display: inline-block; }
      @keyframes ml-up { from { opacity: 0; translate: 0 5px; } }
      @media (prefers-reduced-motion: reduce) { [data-ask-line].ml-sw { animation: none; } .btns .pxb:active { translate: none; } }`,
    run: answer(`line.textContent = SAY[k]; line.classList.remove('ml-sw'); void line.offsetWidth; line.classList.add('ml-sw');
      if (k === 'yes') window.duskBots.state(juno, 'celebrate'); else window.duskBots.state(juno, 'idle');`),
  }),
  B: ask({
    css: `
      .btns .pxb { position: relative; transition: background-color 120ms steps(2, jump-end), translate 60ms steps(1, jump-end) !important; }
      .btns .pxb:active { scale: 1; translate: 0 2px; }
      .ml-check { width: 15px; height: 15px; background: currentColor; clip-path: polygon(0 50%, 20% 50%, 20% 70%, 40% 70%, 40% 50%, 60% 50%, 60% 30%, 80% 30%, 80% 10%, 100% 10%, 100% 30%, 80% 30%, 80% 50%, 60% 50%, 60% 70%, 40% 70%, 40% 90%, 20% 90%, 20% 70%, 0 70%); animation: ml-draw 150ms steps(3, jump-end) both; }
      @keyframes ml-draw { from { clip-path: inset(0 100% 0 0); } }
      .ml-bit { position: fixed; width: 5px; height: 5px; pointer-events: none; z-index: 9; animation: ml-burst 420ms steps(6, jump-end) both; }
      @keyframes ml-burst { to { translate: var(--dx) var(--dy); opacity: 0; } }
      .ml-w { opacity: 0; } .ml-w.on { opacity: 1; }
      @media (prefers-reduced-motion: reduce) { .ml-bit { display: none; } .ml-check { animation: none; } .btns .pxb:active { translate: none; } }`,
    run: answer(`
      line.replaceChildren(...SAY[k].split(/(\\s+)/).map((w) => { const s = document.createElement('span'); s.textContent = w; s.className = 'ml-w'; return s; }));
      const words = [...line.querySelectorAll('.ml-w')];
      if (lab.reduced) words.forEach((w) => w.classList.add('on')); else words.forEach((w, i) => setTimeout(() => w.classList.add('on'), i * 20));
      const yes = ask.querySelector('[data-ans="yes"]');
      if (k === 'yes') {
        yes.replaceChildren(Object.assign(document.createElement('span'), { className: 'ml-check' }), 'sent');
        window.duskBots.state(juno, 'celebrate'); if (!lab.reduced) window.duskBots.react(juno, 'boing');
        const r = yes.getBoundingClientRect(), cols = ['#ffc4dd', '#fff3a0', '#c2ecfc', '#d0cefb', '#e2fb93'];
        if (!lab.reduced) for (let i = 0; i < 10; i++) {
          const bit = document.createElement('i'), a = (i / 10) * Math.PI * 2, d = 40 + (i % 3) * 15;
          bit.className = 'ml-bit'; bit.style.left = (r.left + r.width / 2) + 'px'; bit.style.top = (r.top + r.height / 2) + 'px'; bit.style.background = cols[i % 5];
          bit.style.setProperty('--dx', Math.round(Math.cos(a) * d / 5) * 5 + 'px'); bit.style.setProperty('--dy', Math.round(Math.sin(a) * d / 5) * 5 + 'px');
          document.body.append(bit); setTimeout(() => bit.remove(), 500);
        }
      } else { yes.textContent = 'yes, send it'; window.duskBots.state(juno, 'idle'); }`),
  }),
};

/* page transitions: the bar holds still, the page under it changes */
const pagesHtml = `${fragment("header.bar")}<div class="ml-pages">
  <div data-page="home">${fragment("section.hero", (el) => { el.querySelectorAll(".hb1, .hb2, .pipx, .works, .actions, .hint, .win").forEach((n) => n.remove()); el.setAttribute("data-sky", "#06bafd 0, #3cd0fd 110px, #90e4fc .7, #c2ecfc .9"); el.removeAttribute("data-ground"); el.removeAttribute("data-flowers"); })}</div>
  <div data-page="pricing" data-off>${fragment("section.pricing", (el) => { el.querySelector("#free")?.remove(); el.querySelector(".fine")?.remove(); el.querySelectorAll("[data-mk-reveal]").forEach((n) => n.removeAttribute("data-mk-reveal")); })}</div>
</div>`;
const pages = frame(pagesHtml, 900, 620, `
  .bar { position: absolute; z-index: 5; } .menu { display: none; }
  .ml-pages { display: grid; } .ml-pages > * { grid-area: 1 / 1; min-height: 620px; } .ml-pages > [data-off] { visibility: hidden; }
  .hero { padding-top: 130px; height: 620px; } .pricing { padding-top: 96px; height: 620px; }
  .plans { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; margin-top: 30px; }`);
const nav = (fx: string) => `(async (lab) => {
  const go = (name) => {
    const next = document.querySelector('[data-page="' + name + '"]');
    if (!next.hasAttribute('data-off')) return;
    document.querySelectorAll('[data-page]').forEach((p) => p.toggleAttribute('data-off', p !== next));
    document.querySelectorAll('.bar nav a').forEach((a) => a.toggleAttribute('aria-current', a.textContent === name));
    ${fx}
  };
  document.addEventListener('click', (e) => { const a = e.target.closest('a'); if (!a) return; if (a.matches('.brand')) go('home'); else if (a.textContent === 'pricing') go('pricing'); });
  await lab.wait(900); go('pricing'); await lab.wait(1600); go('home');
})`;

export const sitePages: Item = {
  id: "site-pages",
  title: "page transitions between site pages",
  surface: "site, every page",
  height: 210,
  loopMs: 3400,
  notes: {
    original: "site.css: a clean cut. the next page is prerendered on hover, so it is simply there; the bar holds still. (a crossfade was tried and read as flicker.) here home and a pricing page stand in for any two pages.",
    a: "still no overlap: the old page goes at once, the new one fades in over 150ms. the bar never moves. (cross-document view transition: old root gets no animation, new root a 150ms fade.)",
    b: "the new page's sky uncovers top-down in 5 stepped frames (200ms) and its heading steps up 10px in two frames after 80ms; the bar holds. no crossfade, so nothing doubles up.",
  },
  Original: pages({ run: nav("") }),
  A: pages({
    css: `.ml-in { animation: ml-fade 150ms linear both; } @keyframes ml-fade { from { opacity: 0; } }`,
    run: nav(`next.classList.remove('ml-in'); void next.offsetWidth; next.classList.add('ml-in');`),
  }),
  B: pages({
    css: `
      .ml-in { animation: ml-open 200ms steps(5, jump-end) both; }
      @keyframes ml-open { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0); } }
      .ml-in :is(h1, h2) { animation: ml-up 120ms steps(2, jump-end) 80ms both; }
      @keyframes ml-up { from { translate: 0 10px; opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .ml-in, .ml-in :is(h1, h2) { animation: ml-fade 150ms linear both; } @keyframes ml-fade { from { opacity: 0; } } }`,
    run: nav(`next.classList.remove('ml-in'); void next.offsetWidth; next.classList.add('ml-in');`),
  }),
};

/* pixel sprite motion: the night at the end of the page */
const night = frame(fragment("section.end"), 760, 560, `.end { min-height: 560px; padding-top: 70px; } .end .actions { display: none; }`);
const doze = `(async () => { document.querySelectorAll('svg.dozer').forEach((b) => window.duskBots.state(b, 'asleep')); })`;

export const siteSprites: Item = {
  id: "site-sprites",
  title: "pixel sprite motion (stepped)",
  surface: "site, everywhere",
  height: 230,
  loopMs: 6000,
  notes: {
    original: "px.css / home.css: stars twinkle on a 3.2s ease-in-out opacity loop, the z's breathe 2.8s ease-in-out: smooth fades on pixel art. bots idle, blink and doze in mascot.js.",
    a: "same loops, quantised: twinkles in 2 steps per half, z's in 3, so pixels switch instead of fading. no new motion.",
    b: "stars are 3-frame sprites (dot, plus, dot) on steps(1) frames; the z's drift up 15px on the 5px grid and fade in 6 frames, like a sprite sheet. reduced motion shows frame one.",
  },
  Original: night({ real: true }),
  A: night({
    css: `.tw { animation-timing-function: steps(2, jump-none) !important; } .snore { animation-timing-function: steps(3, jump-none) !important; }`,
    run: doze,
  }),
  B: night({
    css: `
      .tw { animation: ml-tw 2.4s steps(1, jump-end) infinite !important; }
      .tw:nth-of-type(3n) { animation-delay: -.8s !important; } .tw:nth-of-type(3n + 1) { animation-delay: -1.6s !important; }
      @keyframes ml-tw { 0% { box-shadow: none; opacity: 1; } 40% { box-shadow: 5px 0 0 currentColor, -5px 0 0 currentColor, 0 5px 0 currentColor, 0 -5px 0 currentColor; } 55% { box-shadow: none; } 70% { opacity: .35; } 85% { opacity: 1; } }
      .tw { color: #fdfdfd; } .tw:nth-of-type(3n) { color: #fff3a0; }
      .snore { display: inline-block; animation: ml-z 2.4s steps(6, jump-end) infinite !important; }
      @keyframes ml-z { from { translate: 0 0; opacity: 1; } 60% { opacity: 1; } to { translate: 0 -15px; opacity: 0; } }
      @media (prefers-reduced-motion: reduce) { .tw, .snore { animation: none !important; } }`,
    run: doze,
  }),
};
