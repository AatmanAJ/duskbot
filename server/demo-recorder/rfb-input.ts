import { MODIFIER, type RawInput } from "./capture.ts";

export interface RfbDecoder {
  /** The viewer's bytes as they arrive, in any split. */
  push(bytes: Buffer): void;
}

/** X11 keysyms for the keys that write nothing (X11 keysymdef.h). */
const NAMED: Readonly<Record<number, string>> = {
  0xff08: "Backspace", 0xff09: "Tab", 0xfe20: "Tab", 0xff0d: "Enter", 0xff8d: "Enter", 0xff1b: "Escape", 0xffff: "Delete", 0xff63: "Insert",
  0xff50: "Home", 0xff51: "ArrowLeft", 0xff52: "ArrowUp", 0xff53: "ArrowRight", 0xff54: "ArrowDown", 0xff55: "PageUp", 0xff56: "PageDown", 0xff57: "End",
  0xffbe: "F1", 0xffbf: "F2", 0xffc0: "F3", 0xffc1: "F4", 0xffc2: "F5", 0xffc3: "F6", 0xffc4: "F7", 0xffc5: "F8", 0xffc6: "F9", 0xffc7: "F10", 0xffc8: "F11", 0xffc9: "F12",
};
const HELD: Readonly<Record<number, number>> = {
  0xffe1: MODIFIER.shift, 0xffe2: MODIFIER.shift, 0xffe3: MODIFIER.ctrl, 0xffe4: MODIFIER.ctrl,
  0xffe7: MODIFIER.meta, 0xffe8: MODIFIER.meta, 0xffe9: MODIFIER.alt, 0xffea: MODIFIER.alt, 0xffeb: MODIFIER.meta, 0xffec: MODIFIER.meta,
};
/** Keysyms that only change what other keys mean: Caps Lock, Num Lock, Shift Lock, AltGr, Mode switch. */
const SILENT = new Set([0xffe5, 0xff7f, 0xffe6, 0xfe03, 0xff7e, 0xfe11, 0xfe12, 0xfe13]);
const KEYPAD: Readonly<Record<number, string>> = { 0xffaa: "*", 0xffab: "+", 0xffac: ",", 0xffad: "-", 0xffae: ".", 0xffaf: "/", 0xff80: " " };
const BUTTONS = [[1, "left"], [2, "middle"], [4, "right"]] as const;
const WHEEL = [[8, 0, -120], [16, 0, 120], [32, -120, 0], [64, 120, 0]] as const;
const WHEEL_BITS = 8 | 16 | 32 | 64;
const LARGEST_MESSAGE = 16 * 1024 * 1024;

/** The character a keysym writes, or null when it writes none. */
function charOf(keysym: number): string | null {
  if ((keysym >= 0x20 && keysym <= 0x7e) || (keysym >= 0xa0 && keysym <= 0xff)) return String.fromCharCode(keysym);
  if (keysym >= 0x01000100 && keysym <= 0x0110ffff) return String.fromCodePoint(keysym - 0x01000000);
  if (keysym >= 0xffb0 && keysym <= 0xffb9) return String(keysym - 0xffb0);
  if (keysym === 0x20ac) return "€";
  return KEYPAD[keysym] ?? null;
}

/**
 * How long the client message at the start of `bytes` is: 0 when more bytes are needed to tell, -1 when it is no
 * message this reads. The fixed ones are RFC 6143's; the rest are the extensions noVNC 1.5 speaks to TigerVNC.
 */
function messageSize(bytes: Buffer): number {
  const type = bytes[0]!;
  if (type === 0) return 20;
  if (type === 2) return bytes.length < 4 ? 0 : 4 + 4 * bytes.readUInt16BE(2);
  if (type === 3 || type === 150) return 10;
  if (type === 4) return 8;
  if (type === 5) return 6;
  if (type === 6) return bytes.length < 8 ? 0 : 8 + Math.abs(bytes.readInt32BE(4));
  if (type === 248) return bytes.length < 9 ? 0 : 9 + bytes[8]!;
  if (type === 250) return 4;
  if (type === 251) return bytes.length < 7 ? 0 : 8 + 16 * bytes[6]!;
  if (type === 255) {
    if (bytes.length < 4) return 0;
    if (bytes[1] === 0) return 12;
    return bytes[1] === 1 ? (bytes.readUInt16BE(2) === 2 ? 10 : 4) : -1;
  }
  return -1;
}

const VERSION = /^RFB 003\.00[78]\n$/;
const VERSION_BYTES = 12;
const SECURITY_NONE = 1;
const SECURITY_VNC = 2;
const VNC_RESPONSE_BYTES = 16;

/**
 * How many bytes of a viewer's opening handshake come before its first message (RFC 6143 section 7.1, versions 3.7 and
 * 3.8): its version, the security type it chose, the response to a VNC challenge when it chose that, and its ClientInit.
 * 0 when the bytes do not begin a handshake, null while more bytes are needed, -1 for a security type this cannot follow.
 */
function handshakeSize(bytes: Buffer): number | null {
  if (bytes.length < 4) return null;
  if (bytes.toString("latin1", 0, 4) !== "RFB ") return 0;
  if (bytes.length < VERSION_BYTES + 1) return null;
  if (!VERSION.test(bytes.toString("latin1", 0, VERSION_BYTES))) return -1;
  const security = bytes[VERSION_BYTES]!;
  if (security !== SECURITY_NONE && security !== SECURITY_VNC) return -1;
  return VERSION_BYTES + 1 + (security === SECURITY_VNC ? VNC_RESPONSE_BYTES : 0) + 1;
}

/**
 * Reads a person's clicks and keys out of the remote framebuffer protocol their viewer speaks (RFC 6143, client
 * messages 4 and 5). `skip` is how many bytes of the opening handshake come first; left out, a handshake at the start
 * of the bytes is recognised and passed over.
 */
export function createRfbDecoder(onInput: (raw: RawInput) => void, options: { skip?: number } = {}): RfbDecoder {
  let pending: Buffer = Buffer.alloc(0);
  let skip = Math.max(0, options.skip ?? 0);
  let opening = options.skip === undefined;
  let lost = false;
  let mask = 0;
  let at: { x: number; y: number } | null = null;
  let held = 0;

  function key(down: boolean, keysym: number): void {
    const bit = HELD[keysym];
    if (bit !== undefined) {
      held = down ? held | bit : held & ~bit;
      return;
    }
    if (SILENT.has(keysym)) return;
    const char = charOf(keysym);
    const name = char ?? NAMED[keysym];
    if (!name) return;
    const writes = char !== null && !(held & (MODIFIER.ctrl | MODIFIER.alt | MODIFIER.meta));
    onInput({ type: "key", action: down ? "down" : "up", key: name, ...(down && writes ? { text: char } : {}), ...(held ? { modifiers: held } : {}) });
  }

  function pointer(next: number, x: number, y: number): void {
    const changed = next ^ mask;
    const moved = !at || at.x !== x || at.y !== y;
    at = { x, y };
    for (const [bit, deltaX, deltaY] of WHEEL) {
      if (changed & bit && next & bit) onInput({ type: "wheel", x, y, deltaX, deltaY });
    }
    for (const [bit, button] of BUTTONS) {
      if (changed & bit) onInput({ type: "pointer", action: next & bit ? "down" : "up", x, y, button });
    }
    if (!(changed & ~WHEEL_BITS) && !(next & changed & WHEEL_BITS) && moved) onInput({ type: "pointer", action: "move", x, y });
    mask = next;
  }

  return {
    push(bytes) {
      if (lost || !bytes.length) return;
      let rest: Buffer = bytes;
      if (skip > 0) {
        const skipped = Math.min(skip, rest.length);
        skip -= skipped;
        rest = rest.subarray(skipped);
        if (!rest.length) return;
      }
      pending = pending.length ? Buffer.concat([pending, rest]) : rest;
      if (opening) {
        const size = handshakeSize(pending);
        if (size === null) return;
        if (size < 0) {
          lost = true;
          pending = Buffer.alloc(0);
          return;
        }
        opening = false;
        skip = size;
        const skipped = Math.min(skip, pending.length);
        skip -= skipped;
        pending = pending.subarray(skipped);
      }
      while (pending.length) {
        const size = messageSize(pending);
        if (size < 0 || size > LARGEST_MESSAGE) {
          lost = true;
          pending = Buffer.alloc(0);
          return;
        }
        if (size === 0 || pending.length < size) return;
        const type = pending[0]!;
        try {
          if (type === 4) key(pending[1] !== 0, pending.readUInt32BE(4));
          else if (type === 5) pointer(pending[1]!, pending.readUInt16BE(2), pending.readUInt16BE(4));
          else if (type === 255 && pending[1] === 0) key(pending.readUInt16BE(2) !== 0, pending.readUInt32BE(4));
        } catch {
          lost = true;
          pending = Buffer.alloc(0);
          return;
        }
        pending = pending.subarray(size);
      }
    },
  };
}
