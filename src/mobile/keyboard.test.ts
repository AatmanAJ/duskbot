// @vitest-environment happy-dom
import { createElement, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardDismiss, useKeyboardSync } from "./keyboard";
import type { KeyboardFrame, MobilePlatform } from "./platform";

let root: Root;
let host: HTMLDivElement;
let keyboard: ((frame: KeyboardFrame) => void) | null;
const hideKeyboard = vi.fn();

function platform(native: boolean): MobilePlatform {
  return {
    kind: native ? "ios" : "web", native, haptic() {}, hideKeyboard,
    onKeyboard: native ? (listener) => { keyboard = listener; return () => { keyboard = null; }; } : undefined,
    prefs: { get: async () => null, set: async () => {}, remove: async () => {} },
    secrets: { get: async () => null, set: async () => {}, remove: async () => {} },
    openExternal: async () => {}, deviceName: () => "iPhone", appVersion: "test",
  } as MobilePlatform;
}

function Shell({ platform: p }: { platform: MobilePlatform }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeyboardSync(p, ref);
  useKeyboardDismiss(p, ref);
  return createElement("div", { ref, className: "dusk-mobile" },
    createElement("div", { "data-mobile-chat": "" },
      createElement("div", { className: "glass-scroller" }, createElement("p", { id: "bubble" }, "hello")),
      createElement("textarea", { id: "field" })));
}

const list = () => host.querySelector<HTMLElement>(".glass-scroller")!;
const field = () => host.querySelector<HTMLTextAreaElement>("#field")!;
function scrollable(height: number, top: number) {
  Object.defineProperty(list(), "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(list(), "clientHeight", { configurable: true, get: () => 400 });
  list().scrollTop = top;
}
const touch = (target: Element, type: string, y: number, x = 100) => {
  const event = new Event(type, { bubbles: true }) as Event & { touches: Array<{ clientX: number; clientY: number }> };
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
  target.dispatchEvent(event);
};

beforeEach(() => {
  keyboard = null;
  hideKeyboard.mockClear();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(0); return 1; });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the phone keyboard", () => {
  it("goes to the newest row as it starts to rise, however far up the chat was read", () => {
    flushSync(() => root.render(createElement(Shell, { platform: platform(true) })));
    scrollable(2000, 300);
    keyboard!({ height: 336, phase: "will" });
    expect(list().scrollTop).toBe(2000);
  });

  it("is put away by a drag down the transcript, not by a sideways or upward one", () => {
    flushSync(() => root.render(createElement(Shell, { platform: platform(true) })));
    field().focus();
    const bubble = host.querySelector("#bubble")!;
    touch(bubble, "touchstart", 300);
    touch(bubble, "touchmove", 280);
    touch(bubble, "touchmove", 290, 160);
    expect(document.activeElement).toBe(field());
    touch(bubble, "touchend", 0);
    touch(bubble, "touchstart", 300);
    touch(bubble, "touchmove", 324);
    expect(document.activeElement).not.toBe(field());
    expect(hideKeyboard).toHaveBeenCalledOnce();
  });

  it("is put away by a tap on the transcript, but a tap on a control keeps it", () => {
    flushSync(() => root.render(createElement(Shell, { platform: platform(true) })));
    const button = document.createElement("button");
    list().append(button);
    field().focus();
    button.click();
    expect(document.activeElement).toBe(field());
    (host.querySelector("#bubble") as HTMLElement).click();
    expect(document.activeElement).not.toBe(field());
  });
});
