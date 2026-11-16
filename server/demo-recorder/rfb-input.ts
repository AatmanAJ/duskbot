import type { RawInput } from "./capture.ts";

const todo = (): never => { throw new Error("not built"); };

export interface RfbDecoder {
  /** The viewer's bytes as they arrive, in any split. */
  push(bytes: Buffer): void;
}

/**
 * Reads a person's clicks and keys out of the remote framebuffer protocol their viewer speaks (RFC 6143, client
 * messages 4 and 5). `skip` is how many bytes of the opening handshake come first.
 */
export function createRfbDecoder(_onInput: (raw: RawInput) => void, _options?: { skip?: number }): RfbDecoder { return todo(); }
