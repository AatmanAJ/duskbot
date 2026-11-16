import type { Resvg as ResvgClass } from "@resvg/resvg-js";

import { nativeRequire } from "../data/engine.ts";
import type { ImageMasker, ScreenFrame } from "./frames.ts";

/** A masked box reaches this far past the field: a focus ring or a glow can carry the shape of what was typed. */
const PADDING = 2;

let resvgModule: { Resvg: typeof ResvgClass } | null = null;
function loadResvg(): typeof ResvgClass {
  resvgModule ??= nativeRequire()("@resvg/resvg-js") as { Resvg: typeof ResvgClass };
  return resvgModule.Resvg;
}

const whole = (value: number) => (Number.isFinite(value) ? Math.round(value) : 0);

function redrawn(frame: ScreenFrame, boxes: string): ResvgClass {
  const { width, height } = frame;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<image width="${width}" height="${height}" preserveAspectRatio="none" href="data:${frame.type};base64,${frame.data.toString("base64")}"/>${boxes}</svg>`;
  const Resvg = loadResvg();
  return new Resvg(svg, { font: { loadSystemFonts: false }, shapeRendering: 1 });
}

/** The masker the server uses: the picture redrawn with black boxes over it. */
export function resvgMasker(): ImageMasker {
  return {
    async mask(frame, rects) {
      const boxes = rects.map((rect) => {
        const x = whole(rect.x) - PADDING;
        const y = whole(rect.y) - PADDING;
        return `<rect x="${x}" y="${y}" width="${whole(rect.width) + PADDING * 2}" height="${whole(rect.height) + PADDING * 2}" fill="#000"/>`;
      }).join("");
      return redrawn(frame, boxes).render().asPng();
    },
  };
}

/** A picture's pixels, four bytes each (red, green, blue, alpha), row by row. */
export function framePixels(frame: ScreenFrame): { width: number; height: number; pixels: Buffer } {
  const rendered = redrawn(frame, "").render();
  return { width: rendered.width, height: rendered.height, pixels: Buffer.from(rendered.pixels) };
}
