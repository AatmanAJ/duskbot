import type { Item, LabProps } from "@lab/types";
import { fragment, script, SiteFrame, type SiteLook } from "./kit/site";

// the hero, cut down to its title, the two bubbles and pip on the meadow, at a width where they all fit
const html = fragment("section.hero", (el) => {
  el.querySelector(".win-body")!.innerHTML = "";
  el.querySelectorAll(".lede, .works, .actions, .hint").forEach((n) => n.remove());
});
const frameCss = `
  .hero { padding: 34px 16px 0; height: 560px; }
  .hero h1 { font-size: 92px; }
  .hb1, .hb2, .pipx { display: block !important; }
  .hb1 { left: 22px; top: 262px; } .hb2 { right: 22px; top: 352px; }
  .pipx { left: auto; right: 34px; width: 76px; }
  .win { visibility: hidden; height: 40px; margin-top: 238px; }
`;

const original: SiteLook = { real: true };

const a: SiteLook = {
  css: `
    .ml-a [data-pop] { opacity: 0; translate: 0 10px; }
    .ml-a [data-pop].on { opacity: 1; translate: 0 0; transition: opacity 160ms linear, translate 160ms steps(2, jump-end); }
  `,
  run: script(async (lab) => {
    document.documentElement.classList.add("ml-a");
    const [b1, b2] = document.querySelectorAll("[data-pop]");
    if (lab.reduced) { b1!.classList.add("on"); b2!.classList.add("on"); return; }
    await lab.wait(400); b1!.classList.add("on");
    await lab.wait(700); b2!.classList.add("on");
    await lab.wait(160); (window as any).duskBots.react(document.querySelector(".pipx"), "hop");
  }),
};

const b: SiteLook = {
  css: `
    .ml-b [data-pop] { opacity: 0; }
    .ml-b [data-pop].on { opacity: 1; }
    .ml-b [data-pop].on .bub { animation: ml-grow 200ms steps(4, jump-end) backwards; }
    .ml-b [data-pop] .tl { opacity: 0; } .ml-b [data-pop].on .tl { opacity: 1; transition: opacity 0s 200ms; }
    @keyframes ml-grow { from { clip-path: inset(70% 70% 0 0); } to { clip-path: inset(0); } }
    .ml-b .hb2 .bub { animation-name: ml-grow-r !important; }
    @keyframes ml-grow-r { from { clip-path: inset(70% 0 0 70%); } to { clip-path: inset(0); } }
    .ml-b .w { opacity: 0; } .ml-b .w.on { opacity: 1; }
  `,
  run: script(async (lab) => {
    const d = (window as any).duskBots;
    document.documentElement.classList.add("ml-b");
    const bubs = [...document.querySelectorAll<HTMLElement>("[data-pop]")];
    // the bubble text arrives a word at a time, like it's being said
    const words = bubs.map((bw) => {
      const p = bw.querySelector(".bub")!, small = p.querySelector("small")!;
      const text = [...p.childNodes].filter((n) => n !== small).map((n) => n.textContent).join("");
      p.replaceChildren(small, ...text.split(/(\s+)/).map((w) => { const s = document.createElement("span"); s.textContent = w; s.className = "w"; return s; }));
      return [...p.querySelectorAll<HTMLElement>(".w")];
    });
    if (lab.reduced) { bubs.forEach((b) => b.classList.add("on")); words.flat().forEach((w) => w.classList.add("on")); return; }
    const say = async (i: number) => {
      bubs[i]!.classList.add("on");
      await lab.wait(200);
      for (const w of words[i]!) { w.classList.add("on"); if (w.textContent!.trim()) await lab.wait(55); }
    };
    await lab.wait(350); d.react(document.querySelector(".h-mark"), "nod");
    await lab.wait(150); await say(0);
    await lab.wait(380); d.state(document.querySelector(".pipx"), "thinking");
    await lab.wait(520); await say(1);
    d.state(document.querySelector(".pipx"), "idle"); d.react(document.querySelector(".pipx"), "boing");
  }),
};

const Frame = (look: SiteLook) => (p: LabProps) => <SiteFrame {...p} html={html} width={760} height={560} look={look} frameCss={frameCss} />;

export const siteHero: Item = {
  id: "site-hero",
  title: "site hero entrance and bot reactions",
  surface: "site home",
  height: 220,
  loopMs: 4200,
  notes: {
    original: "home.js: bubbles fade 300ms and scale .94 to 1 on a 400ms overshoot curve (0.3,1.5,0.5,1), at 500ms and 1400ms; pip hops 220ms after nova's answer. (mascot physics run at real speed in every column.)",
    a: "bubbles rise 10px in two pixel steps (160ms, steps(2)) with a 160ms fade, at 400ms and 1100ms; pip hops once when nova answers. no scale, no overshoot.",
    b: "kit nods; each bubble opens from its tail in 4 stepped frames (200ms), then its words land 55ms apart; pip thinks while you wait, then boings when the answer lands.",
  },
  Original: Frame(original),
  A: Frame(a),
  B: Frame(b),
};
