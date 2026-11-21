import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_MS, FIT_VIEW, HOLD_MS, MAX_ZOOM, TrackpadGestures, WHEEL_MASK, clampView, followCursor, moveCursor,
  pointerEvents, resizeView, wheelEvents, wheelSteps, zoomView,
} from "./screen-trackpad";

const tap = (g: TrackpadGestures, at: number, id = 1) => [...g.down(id, 100, 100, at), ...g.up(id, at + 60)];

describe("trackpad gestures", () => {
  it("a tap clicks at the cursor and never moves it", () => {
    const g = new TrackpadGestures();
    expect(g.down(1, 100, 100, 0)).toEqual([]);
    expect(g.move(1, 104, 103, 20)).toEqual([]);
    expect(g.up(1, 80)).toEqual([{ kind: "click", button: "left", count: 1 }]);
  });

  it("a double tap is a click and then the second click of a double click", () => {
    const g = new TrackpadGestures();
    expect(tap(g, 0)).toEqual([{ kind: "click", button: "left", count: 1 }]);
    expect(tap(g, 200)).toEqual([{ kind: "click", button: "left", count: 2 }]);
    // a third tap starts over instead of counting a triple
    expect(tap(g, 400)).toEqual([{ kind: "click", button: "left", count: 1 }]);
  });

  it("two taps too far apart in time are two single clicks", () => {
    const g = new TrackpadGestures();
    tap(g, 0);
    expect(tap(g, 60 + DOUBLE_TAP_MS + 1)).toEqual([{ kind: "click", button: "left", count: 1 }]);
  });

  it("one finger dragging moves the cursor relatively, including the travel inside the slop", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 100, 0);
    expect(g.move(1, 112, 100, 16)).toEqual([{ kind: "move", dx: 12, dy: 0, dt: 16 }]);
    expect(g.move(1, 115, 90, 32)).toEqual([{ kind: "move", dx: 3, dy: -10, dt: 16 }]);
    expect(g.up(1, 40)).toEqual([]);
  });

  it("a move between taps breaks the double tap", () => {
    const g = new TrackpadGestures();
    tap(g, 0);
    g.down(1, 100, 100, 100);
    g.move(1, 150, 100, 120);
    g.up(1, 140);
    expect(tap(g, 200)).toEqual([{ kind: "click", button: "left", count: 1 }]);
  });

  it("long press then drag is click-and-drag, released with the finger", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 100, 0);
    expect(g.holdDueAt()).toBe(HOLD_MS);
    expect(g.hold(HOLD_MS - 1)).toEqual([]);
    expect(g.hold(HOLD_MS)).toEqual([{ kind: "press", button: "left", down: true, hold: true }]);
    expect(g.holdDueAt()).toBeNull();
    expect(g.move(1, 130, 100, HOLD_MS + 16)).toEqual([{ kind: "move", dx: 30, dy: 0, dt: HOLD_MS + 16 }]);
    expect(g.up(1, HOLD_MS + 40)).toEqual([{ kind: "press", button: "left", down: false }]);
  });

  it("a moving finger never turns into a long press", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 100, 0);
    g.move(1, 140, 100, 50);
    expect(g.holdDueAt()).toBeNull();
    expect(g.hold(HOLD_MS)).toEqual([]);
  });

  it("a cancelled hold lets the button go", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 100, 0);
    g.hold(HOLD_MS);
    expect(g.cancel()).toEqual([{ kind: "press", button: "left", down: false }]);
  });

  it("a two-finger tap is a right click", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 100, 0);
    g.down(2, 160, 100, 10);
    expect(g.up(1, 90)).toEqual([]);
    expect(g.up(2, 100)).toEqual([{ kind: "click", button: "right", count: 1 }]);
  });

  it("two fingers held too long are no right click", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 100, 0);
    g.down(2, 160, 100, 10);
    expect(g.up(1, 500)).toEqual([]);
    expect(g.up(2, 510)).toEqual([]);
  });

  it("two fingers moving together scroll", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 200, 0);
    g.down(2, 160, 200, 0);
    g.move(1, 100, 185, 16);
    expect(g.move(2, 160, 185, 16)).toEqual([{ kind: "scroll", dx: 0, dy: -15 }]);
    g.move(1, 100, 175, 32);
    expect(g.move(2, 160, 175, 32)).toEqual([{ kind: "scroll", dx: 0, dy: -5 }]);
    expect(g.up(1, 40)).toEqual([]);
    // the finger left behind does not start moving the cursor
    expect(g.move(2, 190, 175, 48)).toEqual([]);
    expect(g.up(2, 60)).toEqual([]);
  });

  it("two fingers spreading pinch to zoom", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 0);
    const [first] = g.move(2, 220, 100, 16);
    expect(first).toMatchObject({ kind: "zoom", factor: 1.2, cx: 160, cy: 100 });
    const [second] = g.move(1, 80, 100, 32);
    expect(second).toMatchObject({ kind: "zoom", cx: 150 });
    expect((second as { factor: number }).factor).toBeCloseTo(140 / 120);
  });

  it("a third finger ends the gesture without clicks", () => {
    const g = new TrackpadGestures();
    g.down(1, 100, 100, 0);
    g.down(2, 150, 100, 0);
    g.down(3, 200, 100, 0);
    expect([...g.up(1, 50), ...g.up(2, 50), ...g.up(3, 50)]).toEqual([]);
  });
});

describe("desktop input from actions", () => {
  it("a click is a press and release at the cursor, keeping any held button", () => {
    expect(pointerEvents({ kind: "click", button: "left", count: 2 }, 10, 20, 0)).toEqual([[10, 20, 1], [10, 20, 0]]);
    expect(pointerEvents({ kind: "click", button: "right", count: 1 }, 10, 20, 0)).toEqual([[10, 20, 4], [10, 20, 0]]);
    expect(pointerEvents({ kind: "press", button: "left", down: true }, 1, 2, 0)).toEqual([[1, 2, 1]]);
    expect(pointerEvents({ kind: "press", button: "left", down: false }, 1, 2, 1)).toEqual([[1, 2, 0]]);
  });

  it("fingers moving up turn the wheel down, carrying the remainder", () => {
    expect(wheelSteps(0, -40, 18)).toEqual({ steps: 2, rest: 4 });
    expect(wheelSteps(4, -14, 18)).toEqual({ steps: 1, rest: 0 });
    expect(wheelSteps(0, 20, 18)).toEqual({ steps: -1, rest: -2 });
    expect(wheelEvents(2, false, 5, 6, 0)).toEqual([[5, 6, WHEEL_MASK.down], [5, 6, 0], [5, 6, WHEEL_MASK.down], [5, 6, 0]]);
    expect(wheelEvents(-1, true, 5, 6, 0)).toEqual([[5, 6, WHEEL_MASK.left], [5, 6, 0]]);
  });

  it("the cursor moves 1:1 when slow, faster when flicked, slower when zoomed, and stays on the screen", () => {
    const desktop = { width: 1280, height: 800 };
    const slow = moveCursor({ x: 640, y: 400 }, { dx: 10, dy: 0, dt: 100 }, desktop, 2, 1);
    expect(slow).toEqual({ x: 660, y: 400 });
    const fast = moveCursor({ x: 640, y: 400 }, { dx: 30, dy: 0, dt: 10 }, desktop, 2, 1);
    expect(fast.x - 640).toBeGreaterThan(60);
    expect(moveCursor({ x: 640, y: 400 }, { dx: 10, dy: 0, dt: 100 }, desktop, 2, 2).x).toBe(650);
    expect(moveCursor({ x: 5, y: 5 }, { dx: -50, dy: 900, dt: 100 }, desktop, 2, 1)).toEqual({ x: 0, y: 799 });
  });
});

describe("zoom and pan", () => {
  it("never zooms out past the frame or shows past the screen's edges", () => {
    expect(clampView({ scale: 0.5, x: 10, y: 10 }, 400, 250)).toEqual(FIT_VIEW);
    expect(clampView({ scale: 2, x: -900, y: 5 }, 400, 250)).toEqual({ scale: 2, x: -400, y: 0 });
    expect(clampView({ scale: 9, x: 0, y: 0 }, 400, 250).scale).toBe(MAX_ZOOM);
  });

  it("a pinch keeps what is under the fingers under them", () => {
    const view = zoomView(FIT_VIEW, { factor: 2, cx: 100, cy: 50, dx: 0, dy: 0 }, 400, 250);
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
    // the content point under (100, 50) is still (100 + 100) / 2 = 100
    expect((100 - view.x) / view.scale).toBe(100);
    const panned = zoomView(view, { factor: 1, cx: 80, cy: 50, dx: -20, dy: 0 }, 400, 250);
    expect(panned).toEqual({ scale: 2, x: -120, y: -50 });
  });

  it("follows the cursor near the edges only when zoomed", () => {
    expect(followCursor(FIT_VIEW, 399, 10, 400, 250)).toBe(FIT_VIEW);
    const view = { scale: 2, x: 0, y: 0 };
    expect(followCursor(view, 100, 50, 400, 250)).toBe(view);
    expect(followCursor(view, 190, 50, 400, 250)).toEqual({ scale: 2, x: -16, y: 0 });
  });

  it("keeps the same part of the screen in view when the phone turns", () => {
    expect(resizeView({ scale: 2, x: -100, y: -50 }, { width: 400, height: 250 }, { width: 800, height: 500 })).toEqual({ scale: 2, x: -200, y: -100 });
  });
});
