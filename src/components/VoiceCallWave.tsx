import { useEffect, useRef } from "react";

const BARS = 26;
const BAR_W = 3;
const GAP = 2.5;
const DOT = 3;

export type WaveSource = () => { level: number; who: "bot" | "person" | "none" };

/** Bars that follow whoever is talking, and settle into a row of dots in silence. Drawn on a canvas each frame, so
 * nothing in React re-renders at 60 fps. */
export function VoiceCallWave({ source, height = 30, className }: { source: WaveSource; height?: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const read = useRef(source);
  read.current = source;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const width = BARS * BAR_W + (BARS - 1) * GAP;
    const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
    el.width = Math.round(width * ratio);
    el.height = Math.round(height * ratio);
    ctx.scale(ratio, ratio);
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const style = getComputedStyle(el);
    const colors = {
      bot: style.getPropertyValue("--wave-bot").trim() || "#6d5efc",
      person: style.getPropertyValue("--wave-person").trim() || "#1c1b22",
      none: style.getPropertyValue("--wave-idle").trim() || "rgba(28,27,34,0.28)",
    };
    const heights = new Float32Array(BARS).fill(DOT);
    let smooth = 0;
    let frame = 0;
    const draw = (time: number) => {
      const { level, who } = read.current();
      smooth += (level - smooth) * (level > smooth ? 0.45 : 0.12);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = colors[smooth < 0.02 ? "none" : who];
      for (let i = 0; i < BARS; i += 1) {
        const centre = 1 - Math.abs(i - (BARS - 1) / 2) / (BARS / 2);
        const shape = 0.35 + 0.65 * Math.sin(centre * Math.PI * 0.5);
        const jitter = reduced ? 1 : 0.55 + 0.45 * Math.abs(Math.sin(time / 170 + i * 1.7) * Math.cos(time / 260 + i * 0.9));
        const target = Math.max(DOT, Math.min(height, DOT + smooth * shape * jitter * (height - DOT) * 1.6));
        heights[i] = heights[i]! + (target - heights[i]!) * 0.35;
        const h = heights[i]!;
        const x = i * (BAR_W + GAP);
        const y = (height - h) / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR_W, h, BAR_W / 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [height]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className={className}
      style={{ width: BARS * BAR_W + (BARS - 1) * GAP, height }}
    />
  );
}
