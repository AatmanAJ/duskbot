// @vitest-environment happy-dom
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
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

const click = (selector: string) => act(async () => { host.querySelector<HTMLElement>(selector)!.click(); });
const mount = async (props: Parameters<typeof MobilePairingCard>[0]) => {
  await act(async () => { root = createRoot(host); root.render(createElement(MobilePairingCard, props)); });
  await flush();
};
const qrs = () => host.querySelectorAll("[aria-label*=\"QR code\"]").length;

it("walks a first phone through choosing it, getting the app and linking, one qr on screen at a time", async () => {
  await mount({ remote: false });
  expect(host.querySelector("[data-phone-progress]")?.getAttribute("data-phone-progress")).toBe("1/3");
  expect(host.querySelector<HTMLButtonElement>("[data-phone-platform=android]")?.disabled, "Google Play is coming soon").toBe(true);
  expect(qrs()).toBe(0);
  await click("[data-phone-platform=ios]");
  expect(host.querySelector("[data-phone-store-step]")).not.toBeNull();
  expect(host.querySelector("[data-phone-app-store]")?.getAttribute("href")).toBe("https://apps.apple.com/app/id6834725640");
  expect(host.querySelector('[aria-label="QR code for dusk bot on the App Store"]')).not.toBeNull();
  expect(qrs()).toBe(1);
  await click("[data-phone-installed]");
  await flush();
  expect(minted, "the link step makes its code on arrival").toBe(1);
  expect(host.querySelector("[data-pairing-tile=qr]")?.getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[aria-label="Phone pairing QR code"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="QR code for dusk bot on the App Store"]')).toBeNull();
  expect(qrs()).toBe(1);
  expect(host.textContent).toContain("Waiting for your phone");
  await click("[data-pairing-back]");
  expect(host.querySelector("[data-phone-store-step]")).not.toBeNull();
});

it("says when the phone links, then folds into the linked phones with a way to link another", async () => {
  let phones: { id: string; name: string; platform: string; lastSeenAt: number }[] = [];
  const base = api.getMockImplementation()!;
  api.mockImplementation(async (path: string, init?: unknown) => path === "/api/mobile/devices" ? { devices: phones, current: null } : base(path, init));
  await mount({ remote: false });
  await click("[data-phone-have-app]");
  await flush();
  phones = [{ id: "p1", name: "Ada's iPhone", platform: "ios", lastSeenAt: Date.now() }];
  await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
  expect(host.querySelector("[data-phone-linked]")?.textContent).toContain("Ada's iPhone linked");
  await click("[data-phone-linked] [data-primary]");
  expect(host.querySelector("[data-phone-flow]")).toBeNull();
  expect(host.textContent).toContain("Linked phones");
  expect(host.textContent).toContain("Ada's iPhone");
  await click("[data-phone-link-another]");
  expect(host.querySelector("[data-phone-flow=platform]")).not.toBeNull();
  expect(host.querySelector("[data-pairing-back]"), "back returns to the linked phones").not.toBeNull();
});

it("on a dusk cloud leads to signing in with the account's email, never to a pairing code the cloud refuses", async () => {
  let sessions: { id: string; label: string; scopes: string[] }[] = [{ id: "me", label: "This window", scopes: ["admin"] }];
  const base = api.getMockImplementation()!;
  api.mockImplementation(async (path: string, init?: unknown) => path === "/api/auth/sessions" ? { sessions, current: "me" } : base(path, init));
  await mount({ remote: false, cloudHome: true, email: "owner@example.test" });
  expect(host.querySelector("[data-phone-flow=platform]"), "this window's own sign-in is not a phone").not.toBeNull();
  await click("[data-phone-platform=ios]");
  await click("[data-phone-installed]");
  await flush();
  expect(host.querySelector("[data-phone-cloud]")).not.toBeNull();
  expect(host.querySelector("[data-phone-cloud-sign-in]")?.textContent).toContain("owner@example.test");
  expect(host.querySelector("[data-pairing-tile]")).toBeNull();
  expect(minted).toBe(0);
  expect(qrs()).toBe(0);
  sessions = [...sessions, { id: "phone", label: "iPhone", scopes: ["admin", "client"] }];
  await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
  expect(host.querySelector("[data-phone-linked]")?.textContent).toContain("Your phone is in");
  await click("[data-phone-linked] [data-primary]");
  expect(host.textContent).toContain("Logs in with owner@example.test");
});

it("swaps the code for a new one a minute before it ends, so the screen never shows a dead code", async () => {
  await mount({ remote: false });
  await click("[data-phone-have-app]");
  await flush();
  await click("[data-pairing-tile=code]");
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
  await mount({ remote: false });
  await click("[data-phone-have-app]");
  await flush();
  for (let i = 0; i < AUTO_RENEWALS + 1; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(minted).toBe(1 + AUTO_RENEWALS);
  expect(host.textContent).toContain("This code expired");
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
