import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { animate, AnimatePresence, motion, MotionConfig, useMotionValue, useMotionTemplate } from "motion/react";
import { ease, ms, spring } from "@lab/tokens";
import { springOf } from "./time";
import "./dash.css";

export function Dash({ reduced, children, className }: { reduced: boolean; children: ReactNode; className?: string }) {
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <div className={`mlw-d ${className ?? ""}`}>{children}</div>
    </MotionConfig>
  );
}

/** a highlight cut from a full-size layer: the leading edge runs on a stiff spring, the trailing one catches up */
export function StretchPill({ box, target, reduced, className, radius = 999 }: {
  box: RefObject<HTMLElement | null>; target: string; reduced: boolean; className?: string; radius?: number;
}) {
  const l = useMotionValue(0), r = useMotionValue(0), t = useMotionValue(0), b = useMotionValue(0);
  const clip = useMotionTemplate`inset(${t}px ${r}px ${b}px ${l}px round ${radius}px)`;
  const first = useRef(true);
  useLayoutEffect(() => {
    const host = box.current, el = host?.querySelector<HTMLElement>(`[data-key="${target}"]`);
    if (!host || !el) return;
    const W = host.clientWidth, H = host.clientHeight;
    const L = el.offsetLeft, R = W - el.offsetLeft - el.offsetWidth, T = el.offsetTop, B = H - el.offsetTop - el.offsetHeight;
    if (first.current || reduced) { l.set(L); r.set(R); t.set(T); b.set(B); first.current = false; return; }
    const right = L > l.get();
    const { lead, trail } = spring;
    const a = [animate(l, L, right ? trail : lead), animate(r, R, right ? lead : trail), animate(t, T, lead), animate(b, B, lead)];
    return () => a.forEach((x) => x.stop());
  }, [target, reduced, box, l, r, t, b]);
  return <motion.span aria-hidden className={className ?? "pill"} style={{ position: "absolute", inset: 0, clipPath: clip, borderRadius: 0 }} />;
}

/** text where only the characters that changed rise in, 8px with a little blur, and the old ones leave upward */
export function RollText({ text, className, distance = 8, blur = 3 }: { text: string; className?: string; distance?: number; blur?: number }) {
  const prev = useRef(text);
  const [shown, setShown] = useState(() => [...text].map((c, i) => ({ c, k: `${i}-${c}-0` })));
  const gen = useRef(0);
  useLayoutEffect(() => {
    if (prev.current === text) return;
    gen.current += 1;
    const before = [...prev.current], after = [...text];
    // align from the right so "$20" -> "$200" keeps its common tail
    const pad = after.length - before.length;
    setShown(after.map((c, i) => {
      const old = before[i - pad];
      return { c, k: old === c ? `${i}-${c}-keep` : `${i}-${c}-${gen.current}` };
    }));
    prev.current = text;
  }, [text]);
  return (
    <span className={className} style={{ display: "inline-flex", whiteSpace: "pre" }} aria-label={text}>
      {shown.map(({ c, k }, i) => (
        <span key={i} aria-hidden style={{ position: "relative", display: "inline-grid" }}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={k} style={{ gridArea: "1 / 1" }}
              initial={{ opacity: 0, y: distance, filter: `blur(${blur}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -distance, filter: `blur(${blur}px)`, transition: { duration: 0.12, ease: ease.out } }}
              transition={{ duration: 0.22, ease: ease.out, delay: i * 0.018 }}>{c}</motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

/** a number on wheels: each digit column turns to its value, later columns a beat behind */
export function Drums({ text, reduced, className, stagger = 0.045 }: { text: string; reduced: boolean; className?: string; stagger?: number }) {
  const chars = [...text];
  return (
    <span className={`mask ${className ?? ""}`} style={{ display: "inline-flex", lineHeight: 1 }} aria-label={text}>
      {chars.map((c, i) => /\d/.test(c)
        ? <Drum key={chars.length - i} d={Number(c)} reduced={reduced} delay={i * stagger} col={i} />
        : <motion.span key={`s${chars.length - i}-${c}`} aria-hidden layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{c}</motion.span>)}
    </span>
  );
}
function Drum({ d, reduced, delay, col }: { d: number; reduced: boolean; delay: number; col: number }) {
  return (
    <span aria-hidden className="drum" style={{ height: "1em" }}>
      <motion.span initial={false} animate={{ y: `${-d}em` }}
        transition={reduced ? { duration: 0 } : springOf(260, 22 + 2 * col, delay)}>
        {Array.from({ length: 10 }, (_, n) => <span key={n} style={{ height: "1em" }}>{n}</span>)}
      </motion.span>
    </span>
  );
}

/** counts through the numbers in between, like the dashboard's Figure (520ms, cubic out) */
export function useCount(target: number, speed: number, reduced: boolean, duration = 520) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useLayoutEffect(() => {
    if (reduced) { from.current = target; setV(target); return; }
    const start = from.current, t0 = performance.now(), D = ms(duration, speed);
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / D), e = 1 - (1 - p) ** 3, n = start + (target - start) * e;
      from.current = n; setV(n);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, speed, reduced, duration]);
  return v;
}

/** a tiny pixel bot (the site's pip), for avatars */
export function PixelBot({ size = 28, color = "#286ef9" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" shapeRendering="crispEdges" aria-hidden style={{ color, display: "block" }}>
      <g transform="translate(10 10) scale(5)">
        <path fill="currentColor" d="M5 4h6v1h-6zM4 5h8v1h-8zM3 6h10v1h-10zM2 7h2v4h-2zM6 7h4v4h-4zM12 7h2v4h-2zM2 11h12v2h-12zM3 13h10v1h-10zM4 14h8v1h-8zM5 15h6v1h-6z" />
        <path fill="#fff" d="M4 7h2v4h-2zM10 7h2v4h-2z" />
      </g>
    </svg>
  );
}
