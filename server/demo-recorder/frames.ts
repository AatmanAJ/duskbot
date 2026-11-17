import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DemoAccessibility, DemoFrame, DemoRect } from "../../shared/demo-recording.ts";

export interface ScreenFrame {
  data: Buffer;
  type: "image/png" | "image/jpeg";
  width: number;
  height: number;
  /** Picture pixels for each unit the screen's boxes and points are measured in; 1 when unset. */
  scale?: number;
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

/** A PNG's or a JPEG's width and height, from its header (PNG 1.2 IHDR; ITU T.81 markers SOF0 to SOF2). */
export function imageSize(data: Buffer): { width: number; height: number; type: ScreenFrame["type"] } | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), type: "image/png" };
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  for (let at = 2; at + 9 < data.length;) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1]!;
    if (marker >= 0xc0 && marker <= 0xc2) return { height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7), type: "image/jpeg" };
    at += 2 + data.readUInt16BE(at + 2);
  }
  return null;
}

export const FRAME_ID = /^f[a-f0-9]{20}$/;
const MAX_BYTES = 150 * 1024 * 1024;
const MAX_FRAME_BYTES = 12 * 1024 * 1024;
const EXTENSION: Record<DemoFrame["type"], string> = { "image/png": "png", "image/jpeg": "jpg" };

export function frameFile(dir: string, frame: Pick<DemoFrame, "id" | "type">): string {
  return join(dir, `${frame.id}.${EXTENSION[frame.type]}`);
}

/** A kept picture's bytes, from the folder a frame store wrote. */
export function readFrameFile(dir: string, frame: Pick<DemoFrame, "id" | "type">): Buffer | null {
  if (!FRAME_ID.test(frame.id) || !(frame.type in EXTENSION)) return null;
  const path = frameFile(dir, frame);
  try {
    return existsSync(path) ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

function onPicture(rect: DemoRect, frame: ScreenFrame): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0
    && rect.x < frame.width && rect.y < frame.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

export function createFrameStore(options: FrameStoreOptions): FrameStore {
  const kept = new Map<string, DemoFrame>();
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  let bytes = 0;
  let skipped = 0;
  const skip = (): null => {
    skipped++;
    return null;
  };
  return {
    async put(frame, secure, accessibility) {
      if (!frame.data.length || frame.data.length > MAX_FRAME_BYTES || !(frame.width > 0 && frame.height > 0)) return skip();
      if (secure === null && accessibility !== "none") return skip();
      const scale = frame.scale !== undefined && frame.scale > 0 && Number.isFinite(frame.scale) ? frame.scale : 1;
      const boxes = (secure ?? []).map((rect) => ({ x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, height: rect.height * scale })).filter((rect) => onPicture(rect, frame));
      let data = frame.data;
      let type = frame.type;
      if (boxes.length) {
        if (!options.masker) return skip();
        try {
          data = await options.masker.mask(frame, boxes);
        } catch {
          return skip();
        }
        if (!data.length) return skip();
        type = "image/png";
      }
      const id = `f${createHash("sha256").update(data).digest("hex").slice(0, 20)}`;
      const known = kept.get(id);
      if (known) return known;
      if (bytes + data.length > maxBytes) return skip();
      const record: DemoFrame = { id, width: frame.width, height: frame.height, type, masked: boxes.length > 0, ...(scale !== 1 ? { scale } : {}) };
      mkdirSync(options.dir, { recursive: true, mode: 0o700 });
      writeFileSync(frameFile(options.dir, record), data, { mode: 0o600 });
      bytes += data.length;
      kept.set(id, record);
      return record;
    },
    read(id) {
      const frame = kept.get(id);
      const data = frame ? readFrameFile(options.dir, frame) : null;
      return frame && data ? { data, type: frame.type } : null;
    },
    list: () => [...kept.values()],
    get skipped() {
      return skipped;
    },
  };
}
