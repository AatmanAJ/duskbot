// the phone's trackpad over a remote screen, as AnyDesk and Jump Desktop do it: a drawn cursor the fingers push around
// (relative), taps that click where the cursor is, two fingers to scroll or right click, and a pinch to look closer.
// pure: the viewer feeds it touches with their times and turns what comes back into desktop input.

/** how far a finger travels before a touch stops being a tap */
export const TAP_SLOP = 8;
/** a still finger held this long presses the button, and dragging then drags */
export const HOLD_MS = 420;
/** a second tap this soon after the first is the second click of a double click */
export const DOUBLE_TAP_MS = 320;
/** two fingers that both lift within this are a right click */
export const TWO_TAP_MS = 300;
/** how far two fingers' midpoint travels before they scroll */
export const SCROLL_SLOP = 10;
/** how much the fingers' spread changes before two fingers pinch rather than scroll */
export const PINCH_RATIO = 0.08;
/** finger travel, in css px, for one wheel notch */
export const WHEEL_STEP = 18;
export const MAX_ZOOM = 4;

export type Button = "left" | "right";

export type TrackpadAction =
  /** move the cursor by a finger's travel, in css px on the phone */
  | { kind: "move"; dx: number; dy: number; dt: number }
  /** press or release a button where the cursor is; `hold` marks the long press that starts a drag */
  | { kind: "press"; button: Button; down: boolean; hold?: boolean }
  /** a whole click where the cursor is; the second of a double tap carries count 2 */
  | { kind: "click"; button: Button; count: 1 | 2 }
  /** two fingers travelled, in css px */
  | { kind: "scroll"; dx: number; dy: number }
  /** the pinch since the last event: spread ratio, the midpoint now, and how far the midpoint moved */
  | { kind: "zoom"; factor: number; cx: number; cy: number; dx: number; dy: number };

type Mode = "idle" | "one" | "move" | "hold" | "two" | "scroll" | "pinch" | "done";
interface Touch { x: number; y: number; startX: number; startY: number; at: number }

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/** Turns touches into trackpad actions. Times are milliseconds from any clock, as long as it is one clock. */
export class TrackpadGestures {
  private touches = new Map<number, Touch>();
  private mode: Mode = "idle";
  private startAt = 0;
  private lastMoveAt = 0;
  private twoAt = 0;
  private twoMoved = false;
  private center = { x: 0, y: 0 };
  private spread = 0;
  private startSpread = 0;
  private startCenter = { x: 0, y: 0 };
  private lastTap: { at: number; count: 1 | 2 } | null = null;
  private holdId: number | undefined;

  get state(): Mode { return this.mode; }

  /** a long press is due at this time, or null when no finger is waiting for one */
  holdDueAt(): number | null {
    return this.mode === "one" ? this.startAt + HOLD_MS : null;
  }

  down(id: number, x: number, y: number, at: number): TrackpadAction[] {
    this.touches.set(id, { x, y, startX: x, startY: y, at });
    const count = this.touches.size;
    if (count === 1) {
      this.mode = "one";
      this.startAt = at;
      this.lastMoveAt = at;
      return [];
    }
    if (count === 2 && (this.mode === "one" || this.mode === "move")) {
      this.mode = "two";
      this.twoAt = at;
      this.twoMoved = false;
      this.lastTap = null;
      const [a, b] = [...this.touches.values()];
      this.center = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
      this.startCenter = { ...this.center };
      this.spread = this.startSpread = Math.max(1, distance(a!.x, a!.y, b!.x, b!.y));
      return [];
    }
    // a second finger during a drag only rests on the glass; a third ends whatever two were doing
    if (this.mode !== "hold") this.mode = "done";
    return [];
  }

  move(id: number, x: number, y: number, at: number): TrackpadAction[] {
    const touch = this.touches.get(id);
    if (!touch) return [];
    const px = touch.x;
    const py = touch.y;
    touch.x = x;
    touch.y = y;
    const dt = Math.max(1, at - this.lastMoveAt);
    switch (this.mode) {
      case "one": {
        if (distance(x, y, touch.startX, touch.startY) <= TAP_SLOP) return [];
        this.mode = "move";
        this.lastTap = null;
        this.lastMoveAt = at;
        // the travel inside the slop is not lost: the cursor catches up to the finger at once
        return [{ kind: "move", dx: x - touch.startX, dy: y - touch.startY, dt }];
      }
      case "move":
      case "hold":
        if (this.mode === "hold" && id !== this.holdId) return [];
        this.lastMoveAt = at;
        return x === px && y === py ? [] : [{ kind: "move", dx: x - px, dy: y - py, dt }];
      case "two":
      case "scroll":
      case "pinch":
        return this.twoFingers();
      default:
        return [];
    }
  }

  up(id: number, at: number): TrackpadAction[] {
    if (!this.touches.has(id)) return [];
    this.touches.delete(id);
    const left = this.touches.size;
    const actions: TrackpadAction[] = [];
    switch (this.mode) {
      case "one": {
        const count: 1 | 2 = this.lastTap && this.lastTap.count === 1 && at - this.lastTap.at <= DOUBLE_TAP_MS ? 2 : 1;
        this.lastTap = { at, count };
        actions.push({ kind: "click", button: "left", count });
        break;
      }
      case "hold":
        if (id === this.holdId || left === 0) {
          actions.push({ kind: "press", button: "left", down: false });
          this.mode = left ? "done" : "idle";
        }
        break;
      case "two":
        // the first finger up keeps waiting for the second; both up in time with no travel is a right click
        if (left === 0 && !this.twoMoved && at - this.twoAt <= TWO_TAP_MS) actions.push({ kind: "click", button: "right", count: 1 });
        else if (left === 1) this.twoMoved ||= at - this.twoAt > TWO_TAP_MS;
        break;
      case "scroll":
      case "pinch":
        // lifting one finger of two never hands the gesture to the other: it waits for a fresh touch
        this.mode = "done";
        break;
    }
    if (left === 0) this.mode = "idle";
    return actions;
  }

  /** the time has come for a still finger to press: call at `holdDueAt()` */
  hold(at: number): TrackpadAction[] {
    if (this.mode !== "one" || at < this.startAt + HOLD_MS) return [];
    this.mode = "hold";
    this.holdId = this.firstId();
    this.lastTap = null;
    return [{ kind: "press", button: "left", down: true, hold: true }];
  }

  /** the system took the touches (a notification, the app switcher): a held button lets go */
  cancel(): TrackpadAction[] {
    const held = this.mode === "hold";
    this.touches.clear();
    this.mode = "idle";
    this.lastTap = null;
    return held ? [{ kind: "press", button: "left", down: false }] : [];
  }

  private firstId(): number | undefined {
    return this.touches.keys().next().value;
  }

  private twoFingers(): TrackpadAction[] {
    if (this.touches.size !== 2) return [];
    const [a, b] = [...this.touches.values()];
    const center = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    const spread = Math.max(1, distance(a!.x, a!.y, b!.x, b!.y));
    const previous = this.center;
    const previousSpread = this.spread;
    this.center = center;
    this.spread = spread;
    if (this.mode === "two") {
      if (Math.abs(spread / this.startSpread - 1) > PINCH_RATIO) {
        this.mode = "pinch";
        this.twoMoved = true;
        return [{ kind: "zoom", factor: spread / this.startSpread, cx: center.x, cy: center.y, dx: center.x - this.startCenter.x, dy: center.y - this.startCenter.y }];
      }
      if (distance(center.x, center.y, this.startCenter.x, this.startCenter.y) > SCROLL_SLOP) {
        this.mode = "scroll";
        this.twoMoved = true;
        return [{ kind: "scroll", dx: center.x - this.startCenter.x, dy: center.y - this.startCenter.y }];
      }
      return [];
    }
    if (this.mode === "scroll") {
      const dx = center.x - previous.x;
      const dy = center.y - previous.y;
      return dx || dy ? [{ kind: "scroll", dx, dy }] : [];
    }
    return [{ kind: "zoom", factor: spread / previousSpread, cx: center.x, cy: center.y, dx: center.x - previous.x, dy: center.y - previous.y }];
  }
}

/** Pointer gain from finger speed (css px per ms): slow is precise, a flick crosses the screen. */
export function trackpadGain(speed: number): number {
  return 1 + Math.min(1, Math.max(0, (speed - 0.25) / 1.1)) * 1.4;
}

/** Wheel notches from two-finger travel. Natural scrolling: fingers moving up bring what is below into view, which
 * on the desktop is the wheel turning down (positive steps). The remainder carries to the next event. */
export function wheelSteps(rest: number, fingerDelta: number, step = WHEEL_STEP): { steps: number; rest: number } {
  const total = rest - fingerDelta;
  const steps = Math.trunc(total / step);
  return { steps, rest: total - steps * step };
}

/** How the screen is shown in its frame: zoom, then offset, in css px of the frame. */
export interface ScreenView { scale: number; x: number; y: number }
export const FIT_VIEW: ScreenView = { scale: 1, x: 0, y: 0 };

/** A view that never zooms out past the frame nor shows anything beyond the screen's edges. */
export function clampView(view: ScreenView, width: number, height: number): ScreenView {
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale));
  const x = Math.min(0, Math.max(width - width * scale, view.x));
  const y = Math.min(0, Math.max(height - height * scale, view.y));
  return { scale, x, y };
}

/** A pinch step: whatever was under the fingers' midpoint stays under it as it zooms and moves. */
export function zoomView(view: ScreenView, action: { factor: number; cx: number; cy: number; dx: number; dy: number }, width: number, height: number): ScreenView {
  const scale = Math.min(MAX_ZOOM, Math.max(1, view.scale * action.factor));
  const ratio = scale / view.scale;
  const fromX = action.cx - action.dx;
  const fromY = action.cy - action.dy;
  return clampView({ scale, x: action.cx - (fromX - view.x) * ratio, y: action.cy - (fromY - view.y) * ratio }, width, height);
}

/** Keeps the cursor in view when zoomed: near an edge, the view slides so the cursor stays `margin` inside it. The
 * cursor is in unzoomed frame px. */
export function followCursor(view: ScreenView, cursorX: number, cursorY: number, width: number, height: number, margin = 36): ScreenView {
  if (view.scale <= 1) return view;
  const onX = view.x + cursorX * view.scale;
  const onY = view.y + cursorY * view.scale;
  const x = onX < margin ? margin - cursorX * view.scale : onX > width - margin ? width - margin - cursorX * view.scale : view.x;
  const y = onY < margin ? margin - cursorY * view.scale : onY > height - margin ? height - margin - cursorY * view.scale : view.y;
  return x === view.x && y === view.y ? view : clampView({ ...view, x, y }, width, height);
}

/** The same view in a frame that changed size (the phone turned): the same part of the screen stays in view. */
export function resizeView(view: ScreenView, from: { width: number; height: number }, to: { width: number; height: number }): ScreenView {
  if (!from.width || !from.height) return clampView(view, to.width, to.height);
  return clampView({ scale: view.scale, x: view.x * (to.width / from.width), y: view.y * (to.height / from.height) }, to.width, to.height);
}

/** The cursor after a finger moved: on-screen travel times gain, through the zoom, into desktop pixels, kept on the
 * screen. `pxPerFrame` is desktop pixels per unzoomed frame px. */
export function moveCursor(cursor: { x: number; y: number }, action: { dx: number; dy: number; dt: number }, desktop: { width: number; height: number }, pxPerFrame: number, scale: number): { x: number; y: number } {
  const gain = trackpadGain(Math.hypot(action.dx, action.dy) / action.dt);
  const k = (gain * pxPerFrame) / scale;
  return {
    x: Math.min(desktop.width - 1, Math.max(0, cursor.x + action.dx * k)),
    y: Math.min(desktop.height - 1, Math.max(0, cursor.y + action.dy * k)),
  };
}

/** RFB button bits: left 1, right 4, wheel up 8, wheel down 16, wheel left 32, wheel right 64. */
export const BUTTON_MASK: Record<Button, number> = { left: 1, right: 4 };
export const WHEEL_MASK = { up: 1 << 3, down: 1 << 4, left: 1 << 5, right: 1 << 6 } as const;

/** The desktop input one action becomes, as [x, y, mask] pointer events at the cursor; `held` is the mask before. */
export function pointerEvents(action: Extract<TrackpadAction, { kind: "press" | "click" }>, x: number, y: number, held: number): Array<[number, number, number]> {
  const bit = BUTTON_MASK[action.button];
  if (action.kind === "press") return [[x, y, action.down ? held | bit : held & ~bit]];
  return [[x, y, held | bit], [x, y, held & ~bit]];
}

/** One wheel notch per step, each a press and release of the wheel button, as noVNC sends a mouse wheel. */
export function wheelEvents(steps: number, horizontal: boolean, x: number, y: number, held: number): Array<[number, number, number]> {
  const bit = horizontal ? (steps > 0 ? WHEEL_MASK.right : WHEEL_MASK.left) : (steps > 0 ? WHEEL_MASK.down : WHEEL_MASK.up);
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < Math.min(12, Math.abs(steps)); i += 1) out.push([x, y, held | bit], [x, y, held]);
  return out;
}

/** X keysyms for the keys a phone keyboard (or one paired to it) sends that are not text. */
export const SPECIAL_KEYS: Record<string, { keysym: number; code: string }> = {
  Backspace: { keysym: 0xff08, code: "Backspace" },
  Enter: { keysym: 0xff0d, code: "Enter" },
  Tab: { keysym: 0xff09, code: "Tab" },
  Escape: { keysym: 0xff1b, code: "Escape" },
  Delete: { keysym: 0xffff, code: "Delete" },
  ArrowLeft: { keysym: 0xff51, code: "ArrowLeft" },
  ArrowUp: { keysym: 0xff52, code: "ArrowUp" },
  ArrowRight: { keysym: 0xff53, code: "ArrowRight" },
  ArrowDown: { keysym: 0xff54, code: "ArrowDown" },
  Home: { keysym: 0xff50, code: "Home" },
  End: { keysym: 0xff57, code: "End" },
};
