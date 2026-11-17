import { describe, expect, it } from "vitest";

import type { RawInput } from "./capture.ts";
import { createRfbDecoder } from "./rfb-input.ts";

const key = (down: boolean, keysym: number) => { const bytes = Buffer.alloc(8); bytes[0] = 4; bytes[1] = down ? 1 : 0; bytes.writeUInt32BE(keysym, 4); return bytes; };
const pointer = (mask: number, x: number, y: number) => { const bytes = Buffer.alloc(6); bytes[0] = 5; bytes[1] = mask; bytes.writeUInt16BE(x, 2); bytes.writeUInt16BE(y, 4); return bytes; };
const version = (text = "RFB 003.008\n") => Buffer.from(text, "latin1");

function decode(chunks: Buffer[]): RawInput[] {
  const seen: RawInput[] = [];
  const decoder = createRfbDecoder((raw) => seen.push(raw));
  for (const chunk of chunks) decoder.push(chunk);
  return seen;
}

const TYPED_H = [{ type: "key", action: "down", key: "h", text: "h" }];

describe("a desktop viewer's opening handshake", () => {
  it("is passed over when the desktop asks for no password", () => {
    expect(decode([Buffer.concat([version(), Buffer.from([1]), Buffer.from([1]), key(true, 0x68)])])).toEqual(TYPED_H);
  });

  it("is passed over with its answer to a VNC password challenge, which is never read as keys", () => {
    const response = Buffer.alloc(16, 4);
    expect(decode([Buffer.concat([version(), Buffer.from([2]), response, Buffer.from([1]), key(true, 0x68)])])).toEqual(TYPED_H);
  });

  it("is passed over however the bytes are split", () => {
    const stream = Buffer.concat([version("RFB 003.007\n"), Buffer.from([2]), Buffer.alloc(16, 5), Buffer.from([0]), pointer(1, 3, 4), key(true, 0x68)]);
    expect(decode([...stream].map((byte) => Buffer.from([byte])))).toEqual([{ type: "pointer", action: "down", x: 3, y: 4, button: "left" }, ...TYPED_H]);
  });

  it("is not looked for in bytes that begin with a message", () => {
    expect(decode([key(true, 0x68)])).toEqual(TYPED_H);
    expect(decode([Buffer.concat([pointer(0, 1, 1), key(true, 0x68)])])).toEqual([{ type: "pointer", action: "move", x: 1, y: 1 }, ...TYPED_H]);
  });

  it("ends the reading when it is one this cannot follow", () => {
    expect(decode([Buffer.concat([version(), Buffer.from([19]), key(true, 0x68)])])).toEqual([]);
    expect(decode([Buffer.concat([version("RFB 003.003\n"), Buffer.from([1]), key(true, 0x68)])])).toEqual([]);
  });
});
