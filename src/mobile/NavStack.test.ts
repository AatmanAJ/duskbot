// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavStack } from "./NavStack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let log: string[];

function render(open: boolean) {
  act(() => root.render(createElement(NavStack, {
    base: createElement("p", null, "home"),
    page: open ? createElement("div", { id: "chat" }, createElement("textarea", { id: "field" })) : null,
    pageKey: open ? "chat" : null,
    onBack: () => log.push("back"),
    onSlide: (path) => { if (path) log.push("slide"); },
    onLeave: () => log.push("leave"),
  })));
}

const touch = (target: Element, type: string, x: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: Array<{ clientX: number; clientY: number }> };
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 300 }] });
  target.dispatchEvent(event);
};

beforeEach(() => {
  log = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { fn(performance.now() + 1000); return 1; });
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(() => ({ commitStyles() {}, cancel() {}, onfinish: null }) as unknown as Animation);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("leaving a page", () => {
  it("puts the keyboard away as a back tap starts, before the page slides", async () => {
    render(true);
    await act(async () => {});
    expect(log).toEqual(["slide"]);
    log = [];
    render(false);
    expect(log).toEqual(["leave", "slide"]);
  });

  it("puts the keyboard away as a finger takes the page back, before it follows the finger", async () => {
    render(true);
    await act(async () => {});
    log = [];
    const page = host.querySelector("#chat")!;
    touch(page, "touchstart", 10);
    touch(page, "touchmove", 40);
    expect(log[0]).toBe("leave");
    expect(log).not.toContain("back");
  });
});
