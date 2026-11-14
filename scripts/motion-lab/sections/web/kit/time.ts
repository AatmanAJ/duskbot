import { ms } from "@lab/tokens";

export const wait = (n: number, speed: number) => new Promise<void>((done) => setTimeout(done, ms(n, speed)));

/** a spring with a column-specific damping, same mass as the lab tokens */
export const springOf = (stiffness: number, damping: number, delay = 0) => ({ type: "spring" as const, stiffness, damping, mass: 1, delay });

/** a spring sampled into a css linear() curve plus its settle time in ms, for css inside the site frames */
export function springCss(stiffness: number, damping: number): { easing: string; duration: number } {
  const dt = 1 / 240;
  let x = 0, v = 0, t = 0, n = 0;
  const pts: number[] = [];
  while (t < 3) {
    v += (-stiffness * (x - 1) - damping * v) * dt; x += v * dt; t += dt; n += 1;
    if (n % 6 === 0) pts.push(x);
    if (t > 0.1 && Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
  }
  return { easing: `linear(0, ${pts.map((p) => p.toFixed(4)).join(", ")}, 1)`, duration: Math.round(t * 1000) };
}
