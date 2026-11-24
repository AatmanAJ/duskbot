import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { mascotTicker } from "@/lib/mascot-ticker";
import { blendMs, blendPoses, dotsShown, poseIn, seedPhase, type LinePose, type WorkingLineVariant } from "@/lib/working-line";
import type { WorkingMood } from "@/lib/working-mood";
import { spriteFace } from "@/pixel/sprite-face";

type Box = { width: number; height: number; left: number; top: number };

const clockNow = () => (typeof performance === "undefined" ? Date.now() : performance.now());
const useClientLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const DOTS = 3;

type Moods = { mood: WorkingMood; at: number; was: { mood: WorkingMood; at: number } | null; begun: number };

/** The working mascot of a WORKING_LINE version: one pose a frame (poseIn) on the shared frame loop, sub-pixel and
 * eased, its faces crossfading on two eye layers and a change of mood gliding over the version's blend. */
export function WorkingLineMascot({ variant, body, mood, seed, reduced, box, ink, eyeInk, thoughtDots }: {
  variant: WorkingLineVariant;
  body: string;
  mood: WorkingMood;
  seed: string;
  reduced: boolean;
  box: Box;
  ink: string;
  eyeInk: string;
  thoughtDots: boolean;
}) {
  const [moods] = useState<{ current: Moods }>(() => { const at = clockNow(); return { current: { mood, at, was: null, begun: at } }; });
  if (moods.current.mood !== mood) {
    const at = clockNow();
    moods.current = { mood, at, was: { mood: moods.current.mood, at: moods.current.at }, begun: moods.current.begun };
  }
  const phase = seedPhase(seed);
  const lift = useRef<HTMLSpanElement>(null);
  const eyes = useRef<HTMLSpanElement>(null);
  const bodyPath = useRef<SVGPathElement>(null);
  const fromPath = useRef<SVGPathElement>(null);
  const toPath = useRef<SVGPathElement>(null);
  const toLayer = useRef<SVGGElement>(null);
  const dots = useRef<Array<HTMLSpanElement | null>>([]);
  const first = spriteFace(body, "idle");
  const unit = box.width / first.G;

  const paint = useRef<(now: number) => void>(() => {});
  paint.current = (now: number) => {
    const m = moods.current;
    const blend = blendMs(variant);
    const k = m.was ? (now - m.at) / blend : 1;
    const current = poseIn(variant, m.mood, now - m.at, phase, reduced);
    const pose: LinePose = m.was && k < 1 && !reduced ? blendPoses(poseIn(variant, m.was.mood, now - m.was.at, phase), current, k) : current;
    if (lift.current) lift.current.style.transform = `translateY(${r3(pose.y * box.height)}px) rotate(${r3(pose.rot)}deg) scale(${r3(pose.sx)}, ${r3(pose.sy)})`;
    if (eyes.current) eyes.current.style.transform = `translate(${r3(pose.eyeX * unit)}px, ${r3(pose.eyeY * unit)}px) scaleY(${r3(1 - 0.85 * pose.blink)})`;
    const from = spriteFace(body, pose.from.face, pose.from.look ?? 0);
    const to = spriteFace(body, pose.to.face, pose.to.look ?? 0);
    bodyPath.current?.setAttribute("d", from.body);
    fromPath.current?.setAttribute("d", from.eyes);
    toPath.current?.setAttribute("d", to.eyes);
    fromPath.current?.setAttribute("opacity", String(r3(1 - pose.mix)));
    toLayer.current?.setAttribute("opacity", String(r3(pose.mix)));
    if (thoughtDots) {
      const shown = reduced ? (m.mood === "thinking" ? 1 : 0) : dotsShown(m.was && k < 1 ? m.was.mood : null, m.mood, k);
      const cycle = reduced ? 1 : ((now - m.begun) / 2100) % 1;
      dots.current.forEach((dot, i) => {
        if (!dot) return;
        const local = reduced ? 1 : Math.max(0, Math.min(1, (cycle * 1.6 - i * 0.25)));
        const glow = reduced ? 0.8 : Math.sin(Math.PI * local);
        dot.style.opacity = String(r3(shown * (0.35 + 0.65 * glow)));
        dot.style.transform = `translateY(${r3(-glow * unit * 0.8)}px)`;
      });
    }
  };

  useClientLayoutEffect(() => { paint.current(clockNow()); });

  useEffect(() => {
    if (reduced) return;
    return mascotTicker.subscribe((now) => paint.current(now));
  }, [reduced]);

  const dotSize = Math.max(3, Math.round(unit * 2));
  return (
    <span className="absolute" style={box}>
      <span ref={lift} className="absolute inset-0" style={{ transformOrigin: "50% 100%" }}>
        <svg width={box.width} height={box.height} viewBox={`0 0 ${first.G} ${first.G}`} shapeRendering="crispEdges" overflow="visible" className="absolute inset-0">
          <path ref={bodyPath} d={first.body} fill={ink} />
        </svg>
        <span ref={eyes} className="absolute inset-0" style={{ transformOrigin: "50% 55%" }}>
          <svg width={box.width} height={box.height} viewBox={`0 0 ${first.G} ${first.G}`} shapeRendering="crispEdges" overflow="visible" className="absolute inset-0">
            <path ref={fromPath} d={first.eyes} fill={eyeInk} />
            <g ref={toLayer} opacity={0}><path ref={toPath} d={first.eyes} fill={eyeInk} /></g>
          </svg>
        </span>
      </span>
      {thoughtDots && Array.from({ length: DOTS }, (_, i) => (
        <span
          key={i}
          ref={(el) => { dots.current[i] = el; }}
          className="absolute rounded-full"
          style={{ width: dotSize, height: dotSize, background: ink, opacity: 0, left: Math.round(box.width * 0.82 + i * (dotSize + 1.5)), top: Math.round(box.height * 0.12 - i * dotSize * 0.9) }}
        />
      ))}
    </span>
  );
}
