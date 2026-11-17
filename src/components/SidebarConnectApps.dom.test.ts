// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { initialState } from "@/state/store";

const inventory = vi.hoisted(() => ({ services: {} as Record<string, { connected: boolean }> }));

vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (original) => ({ ...await original<typeof import("@/state/store")>(), useStore: () => ({ state: initialState, dispatch: vi.fn() }) }))(importOriginal)));
vi.mock("@/lib/connected-apps", () => ({ preloadConnectedApps: async () => ({ services: inventory.services, authoritative: true }) }));
vi.mock("./bot-settings/useBotApps", () => ({ loadAppCards: async () => new Map([["github", { slug: "github", label: "GitHub", logo: null, domain: "github.com" }]]) }));

import { SidebarConnectApps } from "./SidebarConnectApps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function pill(services: Record<string, { connected: boolean }>, circle = false) {
  inventory.services = services;
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(createElement(SidebarConnectApps, { circle })); });
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const button = document.querySelector<HTMLButtonElement>('[data-sidebar-nav="apps"]')!;
  const seen = { label: circle ? button.getAttribute("aria-label") : button.firstElementChild!.textContent, faces: [...button.querySelectorAll("[data-app-face]")].map((face) => face.getAttribute("data-app-face")) };
  act(() => root.unmount());
  document.body.innerHTML = "";
  return seen;
}

it("always asks to connect apps, as grok's pill does, showing the featured apps not yet connected", async () => {
  expect(await pill({})).toEqual({ label: "Connect apps", faces: ["gmail", "notion", "slack"] });
  expect(await pill({ github: { connected: false } }), "an app that is only listed is not connected").toEqual({ label: "Connect apps", faces: ["gmail", "notion", "slack"] });
  expect(await pill({ github: { connected: true } })).toEqual({ label: "Connect apps", faces: ["gmail", "notion", "slack"] });
  expect((await pill({ gmail: { connected: true } })).faces, "a connected app gives its place to the next").toEqual(["notion", "slack", "figma"]);
  expect((await pill({ github: { connected: true } }, true)).label, "the footer's grid button keeps grok's name").toBe("Connect apps");
});

it("opens the Connect Apps window from the footer's grid button", async () => {
  const { connectAppsState, closeConnectApps } = await import("./connect-apps/open");
  closeConnectApps();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(createElement(SidebarConnectApps, { circle: true })); });
  await act(async () => { document.querySelector<HTMLButtonElement>('[data-sidebar-nav="apps"]')!.click(); });
  expect(connectAppsState()).toMatchObject({ open: true, page: { kind: "home" } });
  act(() => { closeConnectApps(); root.unmount(); });
  document.body.innerHTML = "";
});
