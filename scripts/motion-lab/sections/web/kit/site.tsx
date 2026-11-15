import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LabProps } from "@lab/types";
import siteCss from "../../../../../apps/site/public/landing/site.css?raw";
import pxCss from "../../../../../apps/site/public/landing/px.css?raw";
import kitCss from "../../../../../apps/site/public/landing/motion-kit-v2.css?raw";
import homeCss from "../../../../../apps/site/public/landing/home.css?raw";
import mascotJs from "../../../../../apps/site/public/landing/mascot.js?raw";
import skyJs from "../../../../../apps/site/public/landing/px-sky.js?raw";
import motionJs from "../../../../../apps/site/public/landing/motion.min.js?raw";
import kitJs from "../../../../../apps/site/public/landing/motion-kit-v2.js?raw";
import homeJs from "../../../../../apps/site/public/landing/home.js?raw";
import indexHtml from "../../../../../apps/site/public/landing/index.html?raw";
import siteCssUrl from "../../../../../apps/site/public/landing/site.css?url";

// the real site, loaded into a frame per column: its own css, the mascot runtime, the painted skies and (for the
// originals) the real home.js and motion kit. the frame gets the lab's speed through playbackRate and scaled timers,
// and the reduced toggle through a patched matchMedia and rewritten media queries
const BASE = new URL(siteCssUrl.replace(/[^/]*$/, ""), location.href).href;
const rel = (s: string) => s.replace(/(["'(])\/(art|fonts)\//g, "$1$2/");

let doc: Document | null = null;
/** a section (or any element) of the real built home page, by selector */
export function fragment(selector: string, edit?: (el: Element) => void) {
  doc ??= new DOMParser().parseFromString(indexHtml, "text/html");
  const el = doc.querySelector(selector)?.cloneNode(true) as Element | undefined;
  if (!el) throw new Error(`site fragment not found: ${selector}`);
  edit?.(el);
  return el.outerHTML;
}

const reducedCss = (css: string, reduced: boolean) => css
  .replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g, reduced ? "@media all" : "@media not all")
  .replace(/\(prefers-reduced-motion:\s*no-preference\)/g, reduced ? "(max-width: 0px)" : "(min-width: 0px)");

function pre(speed: number, reduced: boolean) {
  return `(() => {
    const S = ${speed}, R = ${reduced};
    window.__lab = { speed: S, reduced: R };
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (/prefers-reduced-motion/.test(q)) {
        const m = /reduce/.test(q) ? R : !R;
        return { matches: m, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } };
      }
      if (/hover: hover/.test(q)) { const r = mm(q); return { ...r, matches: true, media: q, addEventListener() {}, removeEventListener() {} }; }
      return mm(q);
    };
    const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
    window.setTimeout = (f, t, ...a) => st(f, (t || 0) / S, ...a);
    window.setInterval = (f, t, ...a) => si(f, (t || 0) / S, ...a);
    const rate = () => { for (const a of document.getAnimations()) if (a.playbackRate !== S) a.playbackRate = S; requestAnimationFrame(rate); };
    if (S !== 1) requestAnimationFrame(rate);
    addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a[href]')) e.preventDefault(); }, true);
  })();`;
}

export type SiteLook = {
  /** extra css, after the site's own */
  css?: string;
  /** script run on load, with duskBots ready; gets `lab = { speed, reduced, wait(ms) }` */
  run?: string;
  /** load the real home.js and motion kit (the originals) */
  real?: boolean;
};

/** a function's body as a script for the frame */
export const script = (fn: (lab: { speed: number; reduced: boolean; wait(ms: number): Promise<void> }) => unknown) => `(${fn.toString()})`;

export function SiteFrame({ html, width, height, look, replayKey, speed, reduced, frameCss }: LabProps & {
  html: string; width: number; height: number; look: SiteLook; frameCss?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / width, el.clientHeight / height));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);
  const src = useMemo(() => {
    const css = [siteCss, pxCss, kitCss, homeCss].map((c) => reducedCss(rel(c), reduced)).join("\n");
    const run = look.run ? `addEventListener('load', () => { const lab = { speed: ${speed}, reduced: ${reduced}, wait: (ms) => new Promise((r) => setTimeout(r, ms)) }; const go = () => ${look.run}(lab); window.duskBots ? go() : setTimeout(go, 50); });` : "";
    const real = look.real ? `<script>${motionJs}</script><script>${kitJs}</script><script>${homeJs}</script>` : `<script>${motionJs}</script>`;
    return `<!doctype html><html lang="en" class="js"><head><meta charset="utf-8"><base href="${BASE}">
<script>${pre(speed, reduced)}</script>
<style>${css}</style><style>html,body{overflow:hidden;background:transparent}body{min-height:0;display:block}${frameCss ?? ""}${look.css ?? ""}</style></head>
<body class="is-home"><main class="home">${rel(html)}</main>
<script>${mascotJs}</script><script>${skyJs}</script>${real}<script>${run}</script></body></html>`;
  }, [html, look, speed, reduced, frameCss]);
  return (
    <div ref={box} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <iframe key={`${replayKey}-${speed}-${reduced}`} title="site preview" srcDoc={src}
        style={{ position: "absolute", left: "50%", top: 0, width, height, border: 0, transform: `translateX(-50%) scale(${scale})`, transformOrigin: "50% 0", background: "#fff", colorScheme: "light" }} />
    </div>
  );
}
