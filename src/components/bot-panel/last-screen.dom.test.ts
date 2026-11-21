// @vitest-environment happy-dom
import { createElement, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forgetScreens, lastScreen, rememberScreen, SteadyImage } from "./last-screen";
import { useOnScreen } from "./ComputerTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const mount = async (node: ReturnType<typeof createElement>) => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(node));
};
afterEach(async () => { await act(async () => root?.unmount()); root = null; forgetScreens(); vi.useRealTimers(); });

describe("a steady picture", () => {
  it("keeps showing the last picture until the next one is decoded, so it never blinks empty", async () => {
    let decoded!: () => void;
    const decode = vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => new Promise<void>((resolve) => { decoded = resolve; }));
    let show!: (src: string) => void;
    function Frame() { const [src, setSrc] = useState("data:image/png;base64,ONE"); show = setSrc; return createElement(SteadyImage, { src, alt: "screen" }); }
    await mount(createElement(Frame));
    await act(async () => show("data:image/png;base64,TWO"));
    expect(document.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,ONE");
    await act(async () => decoded());
    expect(document.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,TWO");
    decode.mockRestore();
  });

  it("remembers the newest picture of each conversation's screen", () => {
    rememberScreen("nova", "t1", "data:image/jpeg;base64,A");
    rememberScreen("nova", "t1", "data:image/jpeg;base64,B");
    rememberScreen("nova", "t1", null);
    expect(lastScreen("nova", "t1")).toBe("data:image/jpeg;base64,B");
    expect(lastScreen("nova", "t2")).toBeNull();
  });
});

describe("on screen", () => {
  it("stays on screen through a moment out of view (a sheet's spring), and leaves only after it lasts", async () => {
    vi.useFakeTimers();
    let report!: (visible: boolean) => void;
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { report = (visible) => callback([{ isIntersecting: visible }]); }
      observe() {} disconnect() {}
    });
    const seen: boolean[] = [];
    function Probe() { const [box, setBox] = useState<HTMLElement | null>(null); seen.push(useOnScreen(box, 1000)); return createElement("div", { ref: setBox }); }
    await mount(createElement(Probe));
    await act(async () => { report(false); await vi.advanceTimersByTimeAsync(300); report(true); await vi.advanceTimersByTimeAsync(2000); });
    expect(seen.every(Boolean)).toBe(true);
    await act(async () => { report(false); await vi.advanceTimersByTimeAsync(1000); });
    expect(seen.at(-1)).toBe(false);
    vi.unstubAllGlobals();
  });
});
