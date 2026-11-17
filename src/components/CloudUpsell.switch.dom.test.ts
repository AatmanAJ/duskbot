// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ config: {} as Record<string, unknown>, desktop: null as unknown }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: f.config }, dispatch: vi.fn() }), api: vi.fn() }));
vi.mock("./bot-panel/CloudDesktop", () => ({ useCloudDesktop: () => f.desktop }));
import { useSidebarSwitchCta } from "./CloudUpsell";
import { SpotView } from "./SidebarSpot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const feedback = { spot: { kind: "feedback" as const }, act: () => undefined, updated: null, seen: () => undefined, bridge: undefined };
function Spot() {
  return createElement(SpotView, { state: feedback, cta: useSidebarSwitchCta() });
}

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  f.config = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = () => act(async () => { root.render(createElement(Spot)); });
const spot = () => host.querySelector<HTMLElement>("[data-sidebar-spot]");

describe("the sidebar spot for an account with a dusk cloud", () => {
  it("offers the switch to dusk cloud in Give feedback's place, and its close brings Give feedback back", async () => {
    const openHome = vi.fn(() => Promise.resolve());
    f.desktop = { view: { step: "open" }, keep: { shown: false, moved: false }, openHome };
    await render();
    expect(spot()?.dataset.sidebarSpot).toBe("cta");
    expect(spot()?.dataset.spotCta).toBe("cloud-switch");
    expect(spot()?.textContent).toContain("Switch to dusk cloud");
    await act(async () => { host.querySelector<HTMLElement>("[data-spot-cta-start]")!.click(); });
    expect(openHome).toHaveBeenCalledTimes(1);
    await act(async () => { host.querySelector<HTMLElement>("[data-spot-cta-close]")!.click(); });
    expect(spot()?.dataset.sidebarSpot).toBe("feedback");
  });

  it("is Give feedback with no dusk cloud, while the bots move, and on the cloud's own page", async () => {
    for (const [desktop, config] of [
      [{ view: { step: "get" }, keep: null, openHome: () => Promise.resolve() }, {}],
      [{ view: { step: "moving" }, keep: null, openHome: () => Promise.resolve() }, {}],
      [null, {}],
      [{ view: { step: "open" }, keep: null, openHome: () => Promise.resolve() }, { cloudHome: true }],
    ] as const) {
      f.desktop = desktop; f.config = config;
      await render();
      expect(spot()?.dataset.sidebarSpot, JSON.stringify(desktop)).toBe("feedback");
    }
  });
});
