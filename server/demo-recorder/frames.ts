import type { DemoAccessibility, DemoFrame, DemoRect } from "../../shared/demo-recording.ts";

const todo = (): never => { throw new Error("not built"); };

export interface ScreenFrame {
  data: Buffer;
  type: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/** Blacks boxes out of a picture and returns it as a PNG. */
export interface ImageMasker {
  mask(frame: ScreenFrame, rects: readonly DemoRect[]): Promise<Buffer>;
}

export interface FrameStore {
  /**
   * Keeps a picture and returns its record; the same picture twice is kept once. `secure` lists the secure fields on
   * it, null when that could not be read. Security: a picture whose secure fields cannot be blacked out is never kept.
   */
  put(frame: ScreenFrame, secure: readonly DemoRect[] | null, accessibility: DemoAccessibility): Promise<DemoFrame | null>;
  read(id: string): { data: Buffer; type: DemoFrame["type"] } | null;
  list(): DemoFrame[];
  readonly skipped: number;
}

export interface FrameStoreOptions {
  dir: string;
  masker?: ImageMasker;
  /** The most bytes of pictures one recording keeps. */
  maxBytes?: number;
}

export function createFrameStore(_options: FrameStoreOptions): FrameStore { return todo(); }
