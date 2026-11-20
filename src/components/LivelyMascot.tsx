import { useEffect, useRef, useState } from "react";
import { MascotDirector, type MascotVariant } from "@/lib/mascot-motion";
import { mascotTicker } from "@/lib/mascot-ticker";
import type { WorkingMood } from "@/lib/working-mood";
import { poseArt, poseKey } from "@/pixel/pose-frame";

type Box = { width: number; height: number; left: number; top: number };

const clockNow = () => (typeof performance === "undefined" ? Date.now() : performance.now());

/** The working mascot drawn pose by pose (MascotDirector): one shared frame loop, and the svg paths change only when the
 * pose does. `at` drives it from outside (the motion lab) instead of the clock. */
export function LivelyMascot({ variant, body, mood, seed, reduced, box, ink, eyeInk, at }: {
  variant: MascotVariant;
  body: string;
  mood: WorkingMood;
  seed: string;
  reduced: boolean;
  box: Box;
  ink: string;
  eyeInk: string;
  at?: number;
}) {
  const [director] = useState(() => ({ current: new MascotDirector({ variant, seed, reduced, at: at ?? clockNow() }) }));
  if (director.current.variant !== variant || director.current.reducedMotion !== reduced) director.current = new MascotDirector({ variant, seed, reduced, at: at ?? clockNow() });
  director.current.setMood(mood, at ?? clockNow());
  const first = poseArt(body, director.current.pose(at ?? clockNow()));
  const host = useRef<HTMLSpanElement>(null);
  const paths = useRef<{ body: SVGPathElement | null; eyes: SVGPathElement | null; extra: SVGPathElement | null }>({ body: null, eyes: null, extra: null });

  useEffect(() => {
    if (at !== undefined || reduced) return;
    let shown = "";
    let unsubscribe: (() => void) | null = null;
    const paint = (now: number) => {
      const pose = director.current.pose(now);
      const key = poseKey(pose);
      if (key === shown) return;
      shown = key;
      const art = poseArt(body, pose);
      paths.current.body?.setAttribute("d", art.body);
      paths.current.eyes?.setAttribute("d", art.eyes);
      paths.current.extra?.setAttribute("d", art.extra);
    };
    const start = () => { unsubscribe ??= mascotTicker.subscribe(paint); };
    const stop = () => { unsubscribe?.(); unsubscribe = null; };
    const el = host.current;
    if (typeof IntersectionObserver === "undefined" || !el) { start(); return stop; }
    const seen = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()));
    seen.observe(el);
    return () => { seen.disconnect(); stop(); };
  }, [at, reduced, body, director]);

  const view = `0 0 ${first.G} ${first.G}`;
  return (
    <span ref={host} className="absolute" style={box}>
      <svg width={box.width} height={box.height} viewBox={view} shapeRendering="crispEdges" overflow="visible" className="absolute inset-0">
        <path ref={(el) => { paths.current.body = el; }} d={first.body} fill={ink} />
        <path ref={(el) => { paths.current.extra = el; }} d={first.extra} fill={ink} />
        <path ref={(el) => { paths.current.eyes = el; }} d={first.eyes} fill={eyeInk} />
      </svg>
    </span>
  );
}
