// @vitest-environment happy-dom
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ api, ApiError: class ApiError extends Error { status = 0; } }));
vi.mock("@/lib/user-presence", () => ({ requireUserPresence: vi.fn(async () => true) }));
vi.mock("@/lib/companion-bridge", () => ({ companionBridge: () => null }));
vi.mock("../lib/session", async (original) => ({ ...await original<typeof import("../lib/session")>(), readSessionState: async () => ({ kind: "loopback" }) }));
vi.mock("motion/react", async (original) => {
  const actual = await original<typeof import("motion/react")>();
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown>) => rest;
  const motion = new Proxy({}, { get: (_, tag: string) => (props: Record<string, unknown>) => createElement(tag, strip(props)) });
  return { ...actual, motion, AnimatePresence: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children), useReducedMotion: () => true };
});

import { AUTO_RENEWALS, MobilePairingCard, RENEW_BEFORE_MS } from "./MobilePairingCard";
import { ServerPairingCard } from "./ServerPairingCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, minted: number;

beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  host = document.createElement("div"); document.body.append(host);
  minted = 0;
  api.mockReset().mockImplementation(async (path: string) => {
    if (path === "/api/mobile/devices") return { devices: [], current: null };
    if (path === "/api/auth/sessions") return { sessions: [], current: null };
    if (path === "/api/config") return { computerName: "Studio" };
    if (path === "/api/mobile/pairing") {
      minted += 1;
      return { payload: {}, link: `duskbot://pair?m=offer${minted}`, code: `ABCD-EFGH-000${minted}`, expiresAt: Date.now() + 10 * 60_000 };
    }
    throw new Error(`unexpected ${path}`);
  });
});
afterEach(async () => { await act(async () => root?.unmount()); host.remove(); vi.useRealTimers(); });

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

it("swaps the code for a new one a minute before it ends, so the screen never shows a dead code", async () => {
  await act(async () => { root = createRoot(host); root.render(createElement(MobilePairingCard, { remote: false })); });
  await flush();
  await act(async () => { host.querySelector<HTMLButtonElement>("[data-pairing-tile=code]")!.click(); });
  await flush();
  expect(host.querySelector("code")?.textContent).toBe("ABCD EFGH 0001");
  expect(host.textContent).toContain("A new code appears in 9 min");
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 - RENEW_BEFORE_MS - 1_000); });
  expect(minted).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(minted).toBe(2);
  expect(host.querySelector("code")?.textContent).toBe("ABCD EFGH 0002");
  expect(host.textContent).not.toContain("This code expired");
});

it("stops renewing after an hour or so and then says the code ended, with a new code one press away", async () => {
  await act(async () => { root = createRoot(host); root.render(createElement(MobilePairingCard, { remote: false })); });
  await flush();
  await act(async () => { host.querySelector<HTMLButtonElement>("[data-pairing-tile=code]")!.click(); });
  await flush();
  for (let i = 0; i < AUTO_RENEWALS + 1; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(minted).toBe(1 + AUTO_RENEWALS);
  expect(host.textContent).toContain("This code expired");
});

it("puts the App Store qr first on this computer's phone page, and only one qr is on screen", () => {
  const html = renderToStaticMarkup(createElement(MobilePairingCard, { remote: false }));
  expect(html.indexOf("data-phone-store-step")).toBeGreaterThan(-1);
  expect(html.indexOf("data-phone-store-step")).toBeLessThan(html.indexOf("data-pairing-ways"));
  expect(html).toContain("Then link this computer");
  expect(html).toContain("QR code for dusk bot on the App Store");
  expect(html, "the pairing qr waits for its own step").not.toContain("Phone pairing QR code");
});

it("a cloud's phone page has no browser code to type into the app, and Connect your phone never opens one", async () => {
  const phone = { top: createElement("div", { "data-phone-top": "" }), stepping: false, phones: null };
  await act(async () => { root = createRoot(host); root.render(createElement(ServerPairingCard, { initialSession: { kind: "loopback" }, cloudHome: true, simple: true, phone, focusRequest: 2 })); });
  await flush();
  expect(host.querySelector("[data-phone-top]")).not.toBeNull();
  expect(host.querySelector("[data-pair-computer]")).toBeNull();
  expect(host.textContent).not.toContain("Create code");
  // this computer keeps the browser code, folded, and asking for the phone does not unfold it
  await act(async () => root.unmount());
  await act(async () => { root = createRoot(host); root.render(createElement(ServerPairingCard, { initialSession: { kind: "loopback" }, simple: true, phone, focusRequest: 3 })); });
  await flush();
  expect(host.querySelector("[data-pair-computer]")).not.toBeNull();
  expect(host.querySelector<HTMLElement>("#server-pairing-code")?.hidden).toBe(true);
});
