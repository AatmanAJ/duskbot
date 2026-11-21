// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLoadingLaunch } from "@/lib/mascot-loading";
import { MascotLoader } from "./MascotLoader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MascotLoader", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "requestAnimationFrame", "cancelAnimationFrame"] });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    resetLoadingLaunch();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const faces = (naps: boolean) => {
    act(() => root.render(createElement(MascotLoader, { naps, waking: true })));
    const seen = new Set<string>();
    const lines = new Set<string>();
    for (let i = 0; i < 160; i += 1) {
      act(() => { vi.advanceTimersByTime(200); });
      seen.add(host.querySelector("[data-mascot-loader]")!.getAttribute("data-loader-face")!);
      lines.add(host.textContent ?? "");
    }
    return { seen, lines: [...lines].join("|") };
  };

  it("naps on a long wait by default", () => {
    expect(faces(true).seen).toContain("sleeping");
  });

  it("stays awake however long the wait runs when it may not nap", () => {
    const { seen, lines } = faces(false);
    expect(seen).not.toContain("sleeping");
    expect(seen).not.toContain("waking");
    expect(lines).not.toMatch(/stretch/i);
  });
});
