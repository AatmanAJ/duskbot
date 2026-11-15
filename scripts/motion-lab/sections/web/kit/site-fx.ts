import type { SiteLook } from "./site";

/** the original reveal, made to run on load with the scroll-reveal spring the page uses (.55s, bounce .08) */
export const realReveal: SiteLook = { real: true, css: `:root { --mk-spring-load: .55 .08; }` };

/** pixel reveals for the variants: `rise` steps up 10px in two frames, `wipe` uncovers from the bottom in four */
export function reveal(sel: string, kind: "rise" | "wipe", gap: number, extra = ""): SiteLook {
  const anim = kind === "rise"
    ? `ml-rise 160ms steps(2, jump-end) both, ml-fade 160ms linear both`
    : `ml-wipe 220ms steps(4, jump-end) backwards`;
  return {
    css: `
      ${sel} { opacity: 0; }
      ${sel}.ml-in { opacity: 1; animation: ${anim}; animation-delay: calc(var(--k) * ${gap}ms); }
      @keyframes ml-rise { from { translate: 0 10px; } to { translate: 0 0; } }
      @keyframes ml-fade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes ml-wipe { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0 0 0 0); } }
      @media (prefers-reduced-motion: reduce) { ${sel}.ml-in { animation: ml-fade 150ms linear both; } }
    `,
    run: `(async (lab) => {
      await lab.wait(250);
      document.querySelectorAll(${JSON.stringify(sel)}).forEach((el, k) => { el.style.setProperty('--k', k); el.classList.add('ml-in'); });
      ${extra}
    })`,
  };
}
