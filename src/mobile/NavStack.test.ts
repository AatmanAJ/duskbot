// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavStack } from "./NavStack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let log: string[];
let frames: FrameRequestCallback[] | null;
let slides: Array<{ el: Element; to: string; animation: { onfinish: (() => void) | null } }>;

function render(open: boolean | string) {
  const key = open === true ? "chat" : open || null;
  act(() => root.render(createElement(NavStack, {
    base: createElement("p", null, "home"),
    page: key ? createElement("div", { id: key }, createElement("textarea", { id: "field" })) : null,
    pageKey: key,
    onBack: () => log.push("back"),
    onSettled: (shown) => log.push(shown ? "in" : "out"),
    onSlide: (path) => { if (path) log.push(`slide ${path.points.at(-1)}`); },
    onLeave: () => log.push("leave"),
  })));
}

const nextFrame = () => act(() => { const due = frames!.splice(0); for (const fn of due) fn(performance.now()); });
const pageSlide = () => slides.filter((slide) => slide.el.classList.contains("mobile-page")).at(-1)!;
const land = () => act(() => pageSlide().animation.onfinish?.());
const shown = () => host.querySelector(".mobile-page")?.firstElementChild?.id ?? null;

async function opened(key: boolean | string = true) {
  render(key);
  await act(async () => {});
  if (frames) { nextFrame(); await act(async () => {}); nextFrame(); await act(async () => {}); }
  land();
  log = [];
}

const touch = (target: Element, type: string, x: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: Array<{ clientX: number; clientY: number }> };
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 300 }] });
  target.dispatchEvent(event);
};

beforeEach(() => {
  log = [];
  frames = null;
  slides = [];
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { if (frames) frames.push(fn); else fn(performance.now() + 1000); return 1; });
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(function (this: Element, keyframes) {
    const animation = { commitStyles() {}, cancel() {}, onfinish: null, currentTime: 0 };
    const list = keyframes as Keyframe[];
    slides.push({ el: this, to: String(list.at(-1)?.transform ?? list.at(-1)?.opacity), animation });
    return animation as unknown as Animation;
  });
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
    expect(log).toEqual(["slide 0"]);
    log = [];
    render(false);
    expect(log).toEqual(["leave", `slide ${innerWidth}`]);
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

describe("going back", () => {
  it("slides the page out with the list sliding back under it, and unmounts it only once it has left", async () => {
    await opened();
    frames = [];
    render(false);
    expect(log).toEqual(["leave"]);
    expect(shown()).toBe("chat");
    nextFrame();
    expect(log).toEqual(["leave", `slide ${innerWidth}`]);
    const page = pageSlide();
    expect(page.to).toBe(`translateX(${innerWidth}px)`);
    expect(slides.some((slide) => slide.to === "translateX(0px)" && !slide.el.classList.contains("mobile-page"))).toBe(true);
    expect(shown()).toBe("chat");
    land();
    expect(shown()).toBe(null);
    expect(log.at(-1)).toBe("out");
  });

  it("leaves at the same speed a push arrives", async () => {
    await opened();
    const push = slides.find((slide) => slide.to === "translateX(0px)" && slide.el.classList.contains("mobile-page"))!;
    const pushSteps = (HTMLElement.prototype.animate as unknown as { mock: { calls: Array<[Keyframe[]]> } }).mock.calls[slides.indexOf(push)]![0].length;
    render(false);
    const popSteps = (HTMLElement.prototype.animate as unknown as { mock: { calls: Array<[Keyframe[]]> } }).mock.calls.at(-3)![0].length;
    expect(popSteps).toBe(pushSteps);
  });

  it("turns around when the same chat is opened again while it leaves, and stays", async () => {
    await opened();
    frames = [];
    render(false);
    nextFrame();
    render(true);
    nextFrame();
    expect(log.filter((line) => line.startsWith("slide"))).toEqual([`slide ${innerWidth}`, "slide 0"]);
    land();
    expect(log.at(-1)).toBe("in");
    expect(shown()).toBe("chat");
    expect(log).not.toContain("out");
  });

  it("never pops at all when the chat is opened again before the pop's first frame", async () => {
    await opened();
    frames = [];
    render(false);
    render(true);
    nextFrame();
    expect(log.filter((line) => line.startsWith("slide"))).toEqual(["slide 0"]);
    land();
    expect(shown()).toBe("chat");
  });

  it("brings in another chat opened while one leaves, instead of leaving an empty list", async () => {
    await opened();
    frames = [];
    render(false);
    nextFrame();
    render("other");
    nextFrame();
    land();
    expect(shown()).toBe("other");
    expect(log).not.toContain("out");
  });

  it("fades the page out in place with reduced motion, without moving the list", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    await act(async () => render(true));
    await act(async () => { await new Promise((done) => setTimeout(done, 400)); });
    render(false);
    const page = host.querySelector<HTMLElement>(".mobile-page")!;
    expect(page.style.transform).not.toContain(String(innerWidth));
    await act(async () => { await new Promise((done) => setTimeout(done, 400)); });
    expect(shown()).toBe(null);
    expect(host.querySelector<HTMLElement>(".mobile-nav")!.firstElementChild!.getAttribute("style") ?? "").not.toMatch(/translateX\(-/);
  });
});
