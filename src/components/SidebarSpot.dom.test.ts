// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppUpdateState } from "../../electron/app-update.mjs";
import { closeFeedback, useFeedbackOpen } from "@/lib/feedback-sheet";
import type { ServerUpdateCheck } from "@/lib/server-update";
import { RailSpot, SidebarSpot } from "./SidebarSpot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let tell: (state: AppUpdateState) => void = () => {};
let now: AppUpdateState = { ready: null, available: null, progress: null };
const bridge = {
  state: vi.fn(async () => now),
  restart: vi.fn(async () => true),
  download: vi.fn(async () => "0.2.7" as string | null),
  onState: vi.fn((cb: (state: AppUpdateState) => void) => { tell = cb; return () => {}; }),
};
const openExternal = vi.fn(async () => true);
let server: ServerUpdateCheck = { current: "0.2.6", install: "desktop", available: false };
const check = vi.fn(async () => server);
let opened = false;
function Probe() { opened = useFeedbackOpen(); return null; }

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  now = { ready: null, available: null, progress: null, mode: "self" };
  server = { current: "0.2.6", install: "desktop", available: false };
  (window as unknown as { duskDesktop: unknown }).duskDesktop = { appUpdate: bridge, openExternal };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); closeFeedback(); });

const spot = () => host.querySelector<HTMLButtonElement>("[data-sidebar-spot]");
const mount = async (component: typeof SidebarSpot | typeof RailSpot = SidebarSpot) => {
  await act(async () => { root.render([createElement(component, { key: "spot", check }), createElement(Probe, { key: "probe" })]); });
};
const hear = async (state: AppUpdateState) => { await act(async () => { tell(state); }); };

describe("the sidebar's feedback and update spot", () => {
  it("is Give feedback until an update comes, and a click opens the feedback sheet", async () => {
    await mount();
    expect(spot()?.dataset.sidebarSpot).toBe("feedback");
    expect(spot()?.textContent).toBe("Give feedback");
    await act(async () => { spot()!.click(); });
    expect(opened).toBe(true);
  });

  it("on a mac that installs its own: the found update, its download, then Restart to update with its version", async () => {
    await mount();
    await hear({ ready: null, available: "0.2.7", progress: null, mode: "self" });
    expect(spot()?.dataset.appUpdateState).toBe("available");
    expect(spot()?.textContent).toBe("Update to 0.2.7");
    await hear({ ready: null, available: "0.2.7", progress: 0.4, mode: "self" });
    expect(spot()?.textContent).toBe("Downloading update40%");
    expect(spot()?.getAttribute("aria-busy")).toBe("true");
    await hear({ ready: "0.2.7", available: "0.2.7", progress: null, mode: "self" });
    expect(spot()?.dataset.sidebarSpot).toBe("update");
    expect(spot()?.textContent).toBe("Restart to update0.2.7");
    await act(async () => { spot()!.click(); });
    expect(bridge.restart).toHaveBeenCalledTimes(1);
    expect(check).not.toHaveBeenCalled();
    await hear({ ready: null, available: null, progress: null, mode: "self" });
    expect(spot()?.dataset.sidebarSpot).toBe("feedback");
  });

  it("a click on a found update downloads it, then restarts into it once it's ready", async () => {
    now = { ready: null, available: "0.2.7", progress: null, mode: "self" };
    await mount();
    await act(async () => { spot()!.click(); });
    expect(bridge.download).toHaveBeenCalledTimes(1);
    expect(spot()?.dataset.appUpdateState).toBe("downloading");
    await hear({ ready: "0.2.7", available: "0.2.7", progress: null, mode: "self" });
    expect(bridge.restart).toHaveBeenCalledTimes(1);
  });

  it("on Windows and Linux: Update available with its version, which opens the download page", async () => {
    now = { ready: null, available: null, progress: null, mode: "notice" };
    server = { current: "0.2.6", install: "desktop", latest: "0.2.7", available: true, releaseUrl: "https://dusk.bot/download" };
    await mount();
    expect(check).toHaveBeenCalled();
    expect(spot()?.dataset.appUpdateState).toBe("download-page");
    expect(spot()?.textContent).toBe("Update available0.2.7");
    await act(async () => { spot()!.click(); });
    expect(openExternal).toHaveBeenCalledWith("https://dusk.bot/download");
    expect(bridge.download).not.toHaveBeenCalled();
    expect(bridge.restart).not.toHaveBeenCalled();
  });

  it("stays Give feedback when the download page has nothing newer, or names somewhere else", async () => {
    now = { ready: null, mode: "notice" };
    await mount();
    expect(spot()?.dataset.sidebarSpot).toBe("feedback");
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    server = { current: "0.2.6", install: "desktop", latest: "0.2.7", available: true, releaseUrl: "https://example.com/download" };
    await mount();
    expect(spot()?.dataset.sidebarSpot).toBe("feedback");
  });

  it("is Give feedback on a page that isn't this computer's own, and in a browser", async () => {
    (window as unknown as { duskDesktop: unknown }).duskDesktop = { appUpdate: bridge, remoteClient: { active: true } };
    now = { ready: "0.2.7", available: "0.2.7", progress: null, mode: "self" };
    await mount();
    expect(spot()?.dataset.sidebarSpot).toBe("feedback");
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    (window as unknown as { duskDesktop: unknown }).duskDesktop = undefined;
    await mount();
    expect(spot()?.dataset.sidebarSpot).toBe("feedback");
  });

  it("the collapsed sidebar has the same spot as one named round button", async () => {
    await mount(RailSpot);
    expect(spot()?.getAttribute("aria-label")).toBe("Give feedback");
    await hear({ ready: "0.2.7", available: "0.2.7", progress: null, mode: "self" });
    expect(spot()?.getAttribute("aria-label")).toBe("Restart to update, 0.2.7");
    await act(async () => { spot()!.click(); });
    expect(bridge.restart).toHaveBeenCalledTimes(1);
  });
});
