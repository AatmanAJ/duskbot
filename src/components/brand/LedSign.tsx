import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { GLYPH_ROWS, signDots } from "./led-glyphs";
import "./led-sign.css";

const PITCH = 10;
const RADIUS = 3.6;

/** Words on a dot-matrix LED panel, the brand's sign. `lighting` switches it on column by column, with a flicker, the
 * first time it is drawn; reduced motion shows it lit. Without a `label` it is decoration, hidden from assistive tech. */
export function LedSign({ text, label, lighting = false, className }: { text: string; label?: string; lighting?: boolean; className?: string }) {
  const { columns, dots } = useMemo(() => signDots(text), [text]);
  const width = columns * PITCH;
  const height = GLYPH_ROWS * PITCH;
  return (
    <svg {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })} viewBox={`0 0 ${width} ${height}`} data-led-sign="" data-lighting={lighting ? "" : undefined}
      className={cn("led-sign", className)} style={{ aspectRatio: `${width} / ${height}` }}>
      <g className="led-sign-off">
        {dots.filter((dot) => !dot.lit).map((dot) => <circle key={`${dot.x}.${dot.y}`} cx={dot.x * PITCH + PITCH / 2} cy={dot.y * PITCH + PITCH / 2} r={RADIUS} />)}
      </g>
      <g className="led-sign-on">
        {dots.filter((dot) => dot.lit).map((dot) => (
          <circle key={`${dot.x}.${dot.y}`} cx={dot.x * PITCH + PITCH / 2} cy={dot.y * PITCH + PITCH / 2} r={RADIUS}
            style={lighting ? { animationDelay: `${260 + dot.x * 17 + ((dot.x * 7 + dot.y * 3) % 5) * 9}ms` } : undefined} />
        ))}
      </g>
    </svg>
  );
}
