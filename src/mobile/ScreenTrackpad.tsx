import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { t } from "@/lib/i18n";
import type { HapticKind } from "./platform";
import {
  FIT_VIEW, SPECIAL_KEYS, TrackpadGestures, followCursor, moveCursor, pointerEvents, resizeView, wheelEvents, wheelSteps,
  zoomView, type ScreenView, type TrackpadAction,
} from "./screen-trackpad";

/** What the trackpad drives: the remote desktop's pointer and keyboard, in desktop pixels and X keysyms. */
export interface RemoteInput {
  size(): { width: number; height: number } | null;
  pointer(x: number, y: number, mask: number): void;
  key(keysym: number, code: string): void;
  text(text: string): void;
}

/** The viewer that holds the trackpad: touches anywhere on it, margins included, are trackpad touches. */
export const TRACKPAD_SURFACE = "[data-computer-fullscreen]";
/** What keeps its own touches on that surface: the viewer's buttons and the control pill. */
const OWN_TOUCHES = "button, a, input, textarea, select, [data-computer-control]";

/** The phone's trackpad over a remote screen: touches anywhere on the viewer drive a cursor drawn over the picture,
 * and the picture (`screen`) zooms and pans under it. The hidden field takes the phone keyboard's typing. */
export function ScreenTrackpad({ screen, input, keyboard, haptic, label }: {
  screen: RefObject<HTMLElement | null>;
  input: RemoteInput;
  keyboard: RefObject<HTMLInputElement | null>;
  haptic?: (kind: HapticKind) => void;
  label: string;
}) {
  const pad = useRef<HTMLDivElement>(null);
  const cursorEl = useRef<HTMLDivElement>(null);
  const remote = useRef(input);
  remote.current = input;
  const buzz = useRef(haptic);
  buzz.current = haptic;
  const live = useRef({
    gestures: new TrackpadGestures(),
    view: FIT_VIEW as ScreenView,
    cursor: null as { x: number; y: number } | null,
    sent: null as { x: number; y: number } | null,
    mask: 0,
    wheel: { x: 0, y: 0 },
    frame: { width: 0, height: 0 },
    raf: 0,
    hold: 0 as ReturnType<typeof setTimeout> | 0,
  });

  useLayoutEffect(() => {
    const state = live.current;
    const element = pad.current;
    const picture = screen.current;
    if (!element || !picture) return;
    const surface = element.closest<HTMLElement>(TRACKPAD_SURFACE) ?? element;
    // the margins take touches as the picture does: no browser panning, zooming, selecting or callout there
    const claimed = ["touch-action", "user-select", "-webkit-user-select", "-webkit-touch-callout"];
    const before = claimed.map((name) => surface.style.getPropertyValue(name));
    if (surface !== element) for (const name of claimed) surface.style.setProperty(name, "none");

    const desktop = () => remote.current.size();
    const cursorAt = () => {
      const size = desktop();
      if (!size) return null;
      state.cursor ??= { x: size.width / 2, y: size.height / 2 };
      return state.cursor;
    };
    // unzoomed frame px per desktop px, from the picture's own box (noVNC fits it inside the frame)
    const fit = () => {
      const size = desktop();
      const canvas = picture.querySelector("canvas");
      if (!size || !canvas) return null;
      const outer = element.getBoundingClientRect();
      const inner = canvas.getBoundingClientRect();
      const { view } = state;
      return {
        left: (inner.left - outer.left - view.x) / view.scale,
        top: (inner.top - outer.top - view.y) / view.scale,
        scale: inner.width / view.scale / size.width,
      };
    };

    const paint = () => {
      state.raf = 0;
      const cursor = cursorAt();
      const box = fit();
      if (cursor && (state.sent?.x !== Math.round(cursor.x) || state.sent?.y !== Math.round(cursor.y))) {
        state.sent = { x: Math.round(cursor.x), y: Math.round(cursor.y) };
        remote.current.pointer(cursor.x, cursor.y, state.mask);
      }
      if (cursor && box) state.view = followCursor(state.view, box.left + cursor.x * box.scale, box.top + cursor.y * box.scale, state.frame.width, state.frame.height);
      const { view } = state;
      picture.style.transformOrigin = "0 0";
      picture.style.transform = view.scale === 1 ? "" : `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
      if (cursor && box && cursorEl.current) {
        const x = view.x + (box.left + cursor.x * box.scale) * view.scale;
        const y = view.y + (box.top + cursor.y * box.scale) * view.scale;
        cursorEl.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        cursorEl.current.style.opacity = "1";
      }
    };
    const schedule = () => { state.raf ||= requestAnimationFrame(paint); };

    // a button never waits on the next frame: the move before it goes first so it lands where the cursor is drawn
    const flushMove = () => {
      const cursor = cursorAt();
      if (!cursor) return null;
      if (state.sent?.x !== Math.round(cursor.x) || state.sent?.y !== Math.round(cursor.y)) {
        state.sent = { x: Math.round(cursor.x), y: Math.round(cursor.y) };
        remote.current.pointer(cursor.x, cursor.y, state.mask);
      }
      return cursor;
    };
    const run = (actions: TrackpadAction[]) => {
      for (const action of actions) {
        if (action.kind === "move") {
          const size = desktop();
          const box = fit();
          const cursor = cursorAt();
          if (!size || !box || !cursor || !box.scale) continue;
          state.cursor = moveCursor(cursor, action, size, 1 / box.scale, state.view.scale);
          schedule();
        } else if (action.kind === "press" || action.kind === "click") {
          const cursor = flushMove();
          if (!cursor) continue;
          for (const [x, y, mask] of pointerEvents(action, cursor.x, cursor.y, state.mask)) {
            remote.current.pointer(x, y, mask);
            if (action.kind === "press") state.mask = mask;
          }
          if (action.kind === "click" || action.down) buzz.current?.(action.kind === "press" ? "medium" : "light");
        } else if (action.kind === "scroll") {
          const cursor = flushMove();
          if (!cursor) continue;
          const vertical = wheelSteps(state.wheel.y, action.dy);
          const horizontal = wheelSteps(state.wheel.x, action.dx);
          state.wheel = { x: horizontal.rest, y: vertical.rest };
          for (const [x, y, mask] of [...wheelEvents(vertical.steps, false, cursor.x, cursor.y, state.mask), ...wheelEvents(horizontal.steps, true, cursor.x, cursor.y, state.mask)]) {
            remote.current.pointer(x, y, mask);
          }
        } else {
          const rect = element.getBoundingClientRect();
          state.view = zoomView(state.view, { ...action, cx: action.cx - rect.left, cy: action.cy - rect.top }, state.frame.width, state.frame.height);
          schedule();
        }
      }
      clearTimeout(state.hold);
      const due = state.gestures.holdDueAt();
      if (due !== null) state.hold = setTimeout(() => run(state.gestures.hold(performance.now())), Math.max(0, due - performance.now()));
    };

    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      state.view = resizeView(state.view, state.frame, next);
      state.frame = next;
      schedule();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const canvas = picture.querySelector("canvas");
    if (canvas) observer.observe(canvas);

    const handlers = {
      down(event: PointerEvent) {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (surface !== element && event.target instanceof Element && event.target.closest(OWN_TOUCHES)) return;
        surface.setPointerCapture?.(event.pointerId);
        run(state.gestures.down(event.pointerId, event.clientX, event.clientY, event.timeStamp));
      },
      move(event: PointerEvent) {
        // the in-between samples the system coalesced into this frame: drawing still happens once per frame
        const samples = event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event];
        for (const sample of samples) run(state.gestures.move(event.pointerId, sample.clientX, sample.clientY, sample.timeStamp || event.timeStamp));
      },
      up(event: PointerEvent) { run(state.gestures.up(event.pointerId, event.timeStamp)); },
      cancel() { run(state.gestures.cancel()); },
    };
    surface.addEventListener("pointerdown", handlers.down);
    surface.addEventListener("pointermove", handlers.move);
    surface.addEventListener("pointerup", handlers.up);
    surface.addEventListener("pointercancel", handlers.cancel);
    return () => {
      surface.removeEventListener("pointerdown", handlers.down);
      surface.removeEventListener("pointermove", handlers.move);
      surface.removeEventListener("pointerup", handlers.up);
      surface.removeEventListener("pointercancel", handlers.cancel);
      observer.disconnect();
      if (surface !== element) claimed.forEach((name, index) => surface.style.setProperty(name, before[index]!));
      cancelAnimationFrame(state.raf);
      state.raf = 0;
      clearTimeout(state.hold);
      state.gestures.cancel();
      if (state.mask && state.cursor) remote.current.pointer(state.cursor.x, state.cursor.y, 0);
      state.mask = 0;
      state.view = FIT_VIEW;
      picture.style.transform = "";
    };
  }, [screen]);

  useEffect(() => {
    const field = keyboard.current;
    if (!field) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const special = SPECIAL_KEYS[event.key];
      if (!special) return;
      event.preventDefault();
      remote.current.key(special.keysym, special.code);
    };
    const beforeinput = (event: InputEvent) => {
      if (event.inputType === "insertText" || event.inputType === "insertReplacementText") {
        event.preventDefault();
        if (event.data) remote.current.text(event.data);
      } else if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") {
        event.preventDefault();
        remote.current.key(SPECIAL_KEYS.Enter!.keysym, "Enter");
      } else if (event.inputType === "deleteContentBackward") {
        event.preventDefault();
        remote.current.key(SPECIAL_KEYS.Backspace!.keysym, "Backspace");
      }
    };
    // composed text (kana, pinyin) cannot be cancelled while it is composed; it is sent whole once it settles
    const compositionend = (event: CompositionEvent) => {
      if (event.data) remote.current.text(event.data);
      field.value = "";
    };
    field.addEventListener("keydown", keydown);
    field.addEventListener("beforeinput", beforeinput);
    field.addEventListener("compositionend", compositionend);
    return () => {
      field.removeEventListener("keydown", keydown);
      field.removeEventListener("beforeinput", beforeinput);
      field.removeEventListener("compositionend", compositionend);
    };
  }, [keyboard]);

  return (
    <>
      <div ref={pad} data-screen-trackpad="" role="application" aria-label={label}
        className="absolute inset-0 z-[2] touch-none select-none [-webkit-touch-callout:none] [-webkit-user-select:none]" />
      <div ref={cursorEl} data-screen-cursor="" aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-[3] opacity-0 will-change-transform">
        <svg width={16} height={24} viewBox="0 0 14 21" className="absolute -left-px -top-px drop-shadow-[0_1px_1.5px_rgb(0_0_0/0.35)]">
          <path d="M1 1v15.5l3.7-3.5 2.6 6 2.3-1-2.6-5.8H12z" fill="#141414" stroke="#fafafa" strokeWidth="1.6" strokeLinejoin="round" style={{ paintOrder: "stroke" }} />
        </svg>
      </div>
      <input ref={keyboard} type="text" data-screen-keyboard="" aria-label={t("desktopViewer.text")} defaultValue=""
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} enterKeyHint="enter"
        className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0" style={{ fontSize: 16 }} />
    </>
  );
}
