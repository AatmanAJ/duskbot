import type { DemoContext, DemoPoint, DemoRect, DemoSurface, DemoTarget, DemoTrace, DemoAccessibility } from "../../shared/demo-recording.ts";
import type { FrameStore, ScreenFrame } from "./frames.ts";

const todo = (): never => { throw new Error("not built"); };

/** Modifier bits as the Chrome DevTools protocol numbers them. */
export const MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 } as const;

export type RawInput =
  | { type: "pointer"; action: "down" | "up" | "move"; x: number; y: number; button?: "left" | "middle" | "right"; clickCount?: number }
  | { type: "wheel"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; action: "down" | "up"; key: string; text?: string; modifiers?: number }
  | { type: "text"; text: string }
  | { type: "open"; url: string }
  | { type: "choose"; x: number; y: number; label: string };

/** What can be asked about the screen while a person works on it. */
export interface AccessibilityProbe {
  readonly kind: DemoAccessibility;
  at(point: DemoPoint): Promise<DemoTarget | null>;
  focused(): Promise<DemoTarget | null>;
  /** Every secure field on screen now; null when that cannot be told. */
  secureRegions(): Promise<DemoRect[] | null>;
  context(): Promise<DemoContext>;
  /** Headings, notices and alerts on screen now. */
  texts?(): Promise<string[]>;
}

export interface ScreenSource {
  frame(): Promise<ScreenFrame | null>;
}

export interface CaptureLimits {
  maxEvents: number;
  maxDurationMs: number;
  /** A press and release further apart than this many pixels is a drag. */
  dragDistance: number;
}

export const CAPTURE_LIMITS: CaptureLimits = { maxEvents: 400, maxDurationMs: 20 * 60_000, dragDistance: 12 };

export interface CaptureDeps {
  surface: DemoSurface;
  probe: AccessibilityProbe;
  screen: ScreenSource;
  frames: FrameStore;
  now?: () => number;
  /** Takes known secrets out of text that is kept: saved passwords and the shapes of keys and tokens. */
  scrub?: (text: string) => string;
  log?: (line: string) => void;
  limits?: Partial<CaptureLimits>;
}

export interface DemoCapture {
  /**
   * One thing the person did, given before it reaches the screen. Security: what is typed is kept only when
   * accessibility says, before the next click or key that could move focus, that the field is not a secure one.
   */
  input(raw: RawInput): Promise<void>;
  finish(): Promise<DemoTrace>;
  readonly eventCount: number;
}

export function createDemoCapture(_deps: CaptureDeps): DemoCapture { return todo(); }
