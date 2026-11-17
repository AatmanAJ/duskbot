import { createOsProbe, createOsSurface, type DesktopTools } from "./accessibility/os.ts";
import type { RawInput } from "./capture.ts";
import { imageSize, type ScreenFrame } from "./frames.ts";
import type { DemoSeat } from "./host.ts";
import { createRfbDecoder } from "./rfb-input.ts";

/** Where each desktop viewer's input goes while a task is being shown on its screen. */
export interface DesktopTaps {
  /** One viewer joined `target`: the answer hears its bytes for as long as it stays. */
  tap(target: string): (bytes: Buffer) => void;
  /** Sets, or with null ends, what hears the input of every viewer of `target`. */
  listen(target: string, onInput: ((raw: RawInput) => void) | null): void;
}

/**
 * Security: every viewer's bytes are read into clicks and keys only to be handed to a listener; with none set for
 * its screen they are dropped as they are read, and nothing here keeps or logs them.
 */
export function createDesktopTaps(): DesktopTaps {
  const listeners = new Map<string, (raw: RawInput) => void>();
  return {
    tap(target) {
      const decoder = createRfbDecoder((raw) => listeners.get(target)?.(raw));
      return (bytes) => decoder.push(bytes);
    },
    listen(target, onInput) {
      if (onInput) listeners.set(target, onInput);
      else listeners.delete(target);
    },
  };
}

/** A screen picture as the driver hands it over: base64 of a PNG or a JPEG. */
export function desktopFrame(encoded: string): ScreenFrame | null {
  const data = Buffer.from(encoded, "base64");
  const size = imageSize(data);
  return size ? { data, type: size.type, width: size.width, height: size.height } : null;
}

/** The seat a task is shown at, and done again at, on a bot's own desktop, whose viewers are heard through `taps`. */
export function desktopDemoSeat(tools: DesktopTools, target: string, taps: DesktopTaps): DemoSeat {
  const probe = createOsProbe(tools);
  return {
    probe,
    screen: { frame: () => tools.frame() },
    surface: createOsSurface(tools),
    tap(tap) {
      taps.listen(target, tap ? (raw) => {
        probe.note(raw);
        void tap.input(raw);
      } : null);
    },
    where: () => "",
    close: () => taps.listen(target, null),
  };
}
