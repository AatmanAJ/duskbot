import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { MASCOT_INK, type MausColor } from "@/lib/mascot";
import { useHalloweenDressed, wornBody } from "@/lib/halloween-dress";
import { stillSvgPaths } from "@/pixel/engine";
import { bodyShapeFor, type StoredBodyId } from "../../shared/bot-body";
import { mascotFaceInk, type MascotFaceColor } from "../../shared/bot-avatar";
import { bodyFit } from "./mascot-view";

type WorkingBot = { id?: string; color: MausColor; mascotBody?: StoredBodyId | null; mascotFaceColor?: MascotFaceColor | null };

const shapes = new Map<string, { G: number; body: string; eyes: string; eyeMiddle: number }>();

function shapeOf(body: string) {
  const known = shapes.get(body);
  if (known) return known;
  const { G, body: silhouette, eyes } = stillSvgPaths(body, { scale: 1 });
  const rows = [...eyes.matchAll(/M-?\d+ (-?\d+)h/g)].map((m) => Number(m[1]));
  const eyeMiddle = rows.length ? (Math.min(...rows) + Math.max(...rows) + 1) / 2 / G : 0.6;
  const shape = { G, body: silhouette, eyes, eyeMiddle };
  shapes.set(body, shape);
  return shape;
}

function spread(seed: string, periodMs: number): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return `-${(h >>> 0) % periodMs}ms`;
}

/** The bot's own pixel mascot at work, small enough to sit before a word: it bobs, blinks and glances side to side.
 * Each part moves on its own HTML layer by transform alone, so the loop stays on the compositor. */
export function WorkingMascot({ bot, size, eyes, seed = "", className }: { bot: WorkingBot; size: number; eyes?: string; seed?: string; className?: string }) {
  const dressed = useHalloweenDressed();
  const body = bodyShapeFor(wornBody(bot.mascotBody, bot.color, dressed));
  const shape = useMemo(() => shapeOf(body), [body]);
  const fit = bodyFit(body);
  const drawn = Math.round(size * fit.scale);
  const box = { width: drawn, height: drawn, left: Math.round((size - drawn) / 2 + fit.x * size), top: Math.round((size - drawn) / 2 + fit.y * size) };
  const view = `0 0 ${shape.G} ${shape.G}`;
  const key = `${bot.id ?? ""}|${seed}`;
  return (
    <span aria-hidden="true" data-working-mascot="" className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      <span className="working-mascot-bob absolute" style={{ ...box, animationDelay: spread(`${key}|bob`, 1400) }}>
        <svg width={drawn} height={drawn} viewBox={view} shapeRendering="crispEdges" overflow="visible" className="absolute inset-0">
          <path d={shape.body} fill={MASCOT_INK[bot.color] ?? MASCOT_INK.green} />
        </svg>
        <span className="working-mascot-glance absolute inset-0" style={{ animationDelay: spread(`${key}|glance`, 5200) }}>
          <span className="working-mascot-blink absolute inset-0" style={{ transformOrigin: `50% ${shape.eyeMiddle * 100}%`, animationDelay: spread(`${key}|blink`, 3800) }}>
            <svg width={drawn} height={drawn} viewBox={view} shapeRendering="crispEdges" overflow="visible" className="absolute inset-0">
              <path d={shape.eyes} fill={mascotFaceInk(bot.mascotFaceColor) ?? eyes ?? "var(--color-app)"} />
            </svg>
          </span>
        </span>
      </span>
    </span>
  );
}
