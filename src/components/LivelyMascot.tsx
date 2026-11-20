import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MascotDirector, type MascotMotion, type MascotVariant } from "@/lib/mascot-motion";
import { mascotTicker } from "@/lib/mascot-ticker";
import type { WorkingMood } from "@/lib/working-mood";
import { spriteFace } from "@/pixel/sprite-face";
import { drawVoxel, rgbOf, voxelSupported, VOXEL_ROOM } from "@/pixel/voxel";

type Box = { width: number; height: number; left: number; top: number };

const clockNow = () => (typeof performance === "undefined" ? Date.now() : performance.now());
const useClientLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** The working mascot moving in 3D (MascotDirector), drawn as a flat card turned with css 3d transforms or as voxels
 * through one shared WebGL context, on the shared frame loop while it is on screen. `at` drives it from outside (the
 * motion lab) instead of the clock. */
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
  const voxel = variant.startsWith("voxel") && voxelSupported();
  const host = useRef<HTMLSpanElement>(null);
  const lift = useRef<HTMLSpanElement>(null);
  const turn = useRef<HTMLSpanElement>(null);
  const front = useRef<{ body: SVGPathElement | null; eyes: SVGPathElement | null; back: SVGPathElement | null; shade: SVGPathElement | null }>({ body: null, eyes: null, back: null, shade: null });
  const canvas = useRef<HTMLCanvasElement>(null);
  const first = spriteFace(body, "idle");

  const paint = useRef<(now: number) => void>(() => {});
  paint.current = (() => {
    let shown = "";
    let colours: { ink: ReturnType<typeof rgbOf>; eye: ReturnType<typeof rgbOf> } | null = null;
    let frames = 0;
    return (now: number) => {
      const m: MascotMotion = director.current.motion(now);
      const sprite = spriteFace(body, m.face, m.look, m.blink);
      if (voxel) {
        const ctx = canvas.current?.getContext("2d");
        if (!ctx || !host.current) return;
        if (!colours || frames++ % 60 === 0) colours = { ink: rgbOf(host.current, ink), eye: rgbOf(host.current, eyeInk) };
        drawVoxel(ctx, sprite, m, colours.ink, colours.eye);
        return;
      }
      if (lift.current) lift.current.style.transform = `translate3d(0, ${r3(m.y * box.height)}px, 0) scale(${r3(m.sx)}, ${r3(m.sy)})`;
      if (turn.current) turn.current.style.transform = `perspective(${box.width * 4}px) rotateY(${r3(m.ry)}deg) rotateX(${r3(-m.rx)}deg) rotateZ(${r3(m.rz)}deg)`;
      if (sprite.key !== shown) {
        shown = sprite.key;
        front.current.body?.setAttribute("d", sprite.body);
        front.current.eyes?.setAttribute("d", sprite.eyes);
        front.current.back?.setAttribute("d", sprite.body);
        front.current.shade?.setAttribute("d", sprite.body);
      }
    };
  })();

  useClientLayoutEffect(() => {
    paint.current(at ?? clockNow());
  });

  useEffect(() => {
    if (at !== undefined || reduced) return;
    let unsubscribe: (() => void) | null = null;
    const tick = (now: number) => paint.current(now);
    const start = () => { unsubscribe ??= mascotTicker.subscribe(tick); };
    const stop = () => { unsubscribe?.(); unsubscribe = null; };
    const el = host.current;
    if (typeof IntersectionObserver === "undefined" || !el) { start(); return stop; }
    const seen = new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()));
    seen.observe(el);
    return () => { seen.disconnect(); stop(); };
  }, [at, reduced]);

  const view = `0 0 ${first.G} ${first.G}`;
  if (voxel) {
    const dpr = typeof window === "undefined" ? 1 : Math.max(1, Math.round(window.devicePixelRatio || 1));
    const side = box.width * VOXEL_ROOM, pixels = Math.round(side * dpr);
    const room = (side - box.width) / 2;
    return (
      <span ref={host} className="absolute" style={box}>
        <canvas ref={canvas} width={pixels} height={pixels} className="pointer-events-none absolute" style={{ width: side, height: side, left: -room, top: -room }} />
      </span>
    );
  }
  const face = { backfaceVisibility: "hidden" as const, WebkitBackfaceVisibility: "hidden" as const };
  return (
    <span ref={host} className="absolute" style={box}>
      <span ref={lift} className="absolute inset-0" style={{ transformOrigin: "50% 100%", willChange: "transform" }}>
        <span ref={turn} className="absolute inset-0" style={{ transformStyle: "preserve-3d", transformOrigin: "50% 55%" }}>
          <svg width={box.width} height={box.height} viewBox={view} shapeRendering="crispEdges" overflow="visible" className="absolute inset-0" style={face}>
            <path ref={(el) => { front.current.body = el; }} d={first.body} fill={ink} />
            <path ref={(el) => { front.current.eyes = el; }} d={first.eyes} fill={eyeInk} />
          </svg>
          <svg width={box.width} height={box.height} viewBox={view} shapeRendering="crispEdges" overflow="visible" className="absolute inset-0" style={{ ...face, transform: "rotateY(180deg)" }}>
            <path ref={(el) => { front.current.back = el; }} d={first.body} fill={ink} />
            <path ref={(el) => { front.current.shade = el; }} d={first.body} fill="#000" fillOpacity={0.18} />
          </svg>
        </span>
      </span>
    </span>
  );
}
