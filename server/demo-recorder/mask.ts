import type { ImageMasker, ScreenFrame } from "./frames.ts";

const todo = (): never => { throw new Error("not built"); };

/** The masker the server uses: the picture redrawn with black boxes over it. */
export function resvgMasker(): ImageMasker { return todo(); }

/** A picture's pixels, four bytes each (red, green, blue, alpha), row by row. */
export function framePixels(_frame: ScreenFrame): { width: number; height: number; pixels: Buffer } { return todo(); }
