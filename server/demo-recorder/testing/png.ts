// A PNG writer and reader for tests, apart from the code under test: 8-bit RGB and RGBA, not interlaced (PNG 1.2).
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

export type Rgb = readonly [number, number, number];

export interface Picture {
  width: number;
  height: number;
  /** Four bytes a pixel: red, green, blue, alpha. */
  pixels: Buffer;
}

export function blankPicture(width: number, height: number, color: Rgb): Picture {
  const pixels = Buffer.alloc(width * height * 4);
  for (let at = 0; at < pixels.length; at += 4) {
    pixels[at] = color[0];
    pixels[at + 1] = color[1];
    pixels[at + 2] = color[2];
    pixels[at + 3] = 255;
  }
  return { width, height, pixels };
}

export function fillRect(picture: Picture, rect: { x: number; y: number; width: number; height: number }, color: Rgb): void {
  for (let y = Math.max(0, rect.y); y < Math.min(picture.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(picture.width, rect.x + rect.width); x++) {
      const at = (y * picture.width + x) * 4;
      picture.pixels[at] = color[0];
      picture.pixels[at + 1] = color[1];
      picture.pixels[at + 2] = color[2];
      picture.pixels[at + 3] = 255;
    }
  }
}

export function pixelAt(picture: Picture, x: number, y: number): Rgb {
  const at = (y * picture.width + x) * 4;
  return [picture.pixels[at]!, picture.pixels[at + 1]!, picture.pixels[at + 2]!];
}

export function encodePng(picture: Picture): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(picture.width, 0);
  header.writeUInt32BE(picture.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = picture.width * 4;
  const raw = Buffer.alloc((stride + 1) * picture.height);
  for (let y = 0; y < picture.height; y++) picture.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(data: Buffer): Picture {
  if (!data.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let width = 0;
  let height = 0;
  let channels = 0;
  const parts: Buffer[] = [];
  for (let at = 8; at + 8 <= data.length;) {
    const size = data.readUInt32BE(at);
    const type = data.toString("ascii", at + 4, at + 8);
    const body = data.subarray(at + 8, at + 8 + size);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error("only 8-bit PNGs that are not interlaced");
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : 0;
      if (!channels) throw new Error("only RGB and RGBA PNGs");
    } else if (type === "IDAT") parts.push(body);
    at += 12 + size;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]!;
      const left = x >= channels ? rows[y * stride + x - channels]! : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels]! : 0;
      const add = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upLeft);
      rows[y * stride + x] = (value + add) & 0xff;
    }
  }
  if (channels === 4) return { width, height, pixels: rows };
  const pixels = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) rows.copy(pixels, i * 4, i * 3, i * 3 + 3);
  return { width, height, pixels };
}
