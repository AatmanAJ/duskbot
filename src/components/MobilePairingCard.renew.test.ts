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

it("shows a first phone one screen: one qr that opens the app or the store page, the typed code beside it, the stores under it", async () => {
  await mount({ remote: false });
  await flush();
  expect(host.querySelector("[data-phone-progress]"), "no steps").toBeNull();
  expect(host.querySelector("[data-phone-flow=link]")).not.toBeNull();
  expect(host.textContent).toContain("Link your phone");
  expect(minted, "the screen makes its code on arrival").toBe(1);
  expect(qrs()).toBe(1);
  expect(host.querySelector("[data-phone-qr]")?.getAttribute("data-phone-qr")).toBe("https://dusk.bot/m/pair#m=offer1&c=ABCDEFGH0001");
  expect(host.querySelector("[data-phone-code]")?.textContent).toBe("ABCD EFGH 0001");
  expect(host.textContent).toContain("Scan with your phone's camera, or type the code in the dusk bot app.");
  expect(host.textContent).toContain("Waiting for your phone");
  expect(host.querySelector("[data-phone-app-store]")?.getAttribute("href")).toBe("https://apps.apple.com/app/id6834725640");
  expect(host.querySelector("[data-phone-app-store] [data-store-mark=apple]")).not.toBeNull();
  expect(host.querySelector("[data-phone-google-play] [data-store-mark=android]")).not.toBeNull();
  expect(host.querySelector("[data-phone-google-play]")?.textContent).toContain("Coming soon");
  expect(host.querySelector("[data-pairing-back]"), "nowhere to go back to without a phone").toBeNull();
});

it("says when the phone links, then folds into the linked phones with a way to link another", async () => {
  let phones: { id: string; name: string; platform: string; lastSeenAt: number }[] = [];
  const base = api.getMockImplementation()!;
  api.mockImplementation(async (path: string, init?: unknown) => path === "/api/mobile/devices" ? { devices: phones, current: null } : base(path, init));
  await mount({ remote: false });
  await flush();
  phones = [{ id: "p1", name: "Ada's iPhone", platform: "ios", lastSeenAt: Date.now() }];
  await act(async () => { await vi.advanceTimersByTimeAsync(2_100); });
  expect(host.querySelector("[data-phone-linked]")?.textContent).toContain("Ada's iPhone linked");
  await click("[data-phone-linked] [data-primary]");
  expect(host.querySelector("[data-phone-flow]")).toBeNull();
  expect(host.textContent).toContain("Linked phones");
  expect(host.textContent).toContain("Ada's iPhone");
  await click("[data-phone-link-another]");
  await flush();
  expect(host.querySelector("[data-phone-flow=link]")).not.toBeNull();
  expect(minted, "linking another makes a fresh code").toBe(2);
  expect(host.querySelector("[data-pairing-back]"), "back returns to the linked phones").not.toBeNull();
  await click("[data-pairing-back]");
  expect(host.querySelector("[data-phone-flow]")).toBeNull();
});

it("on a dusk cloud shows one qr that opens the app's log in with the account's email, never a pairing code the cloud refuses", async () => {
  let sessions: { id: string; label: string; scopes: string[] }[] = [{ id: "me", label: "This window", scopes: ["admin"] }];
  const base = api.getMockImplementation()!;
  api.mockImplementation(async (path: string, init?: unknown) => path === "/api/auth/sessions" ? { sessions, current: "me" } : base(path, init));
  await mount({ remote: false, cloudHome: true, email: "owner@example.test" });
  expect(host.querySelector("[data-phone-cloud]"), "this window's own sign-in is not a phone").not.toBeNull();
  expect(host.querySelector("[data-phone-cloud-sign-in]")?.textContent).toContain("Log in with");
  expect(host.querySelector("[data-phone-cloud-sign-in]")?.textContent).toContain("owner@example.test");
  expect(host.querySelector("[data-phone-qr]")?.getAttribute("data-phone-qr")).toBe("https://dusk.bot/m/signin#email=owner%40example.test");
  expect(host.querySelector("[data-phone-code]")).toBeNull();
  expect(minted).toBe(0);
  expect(qrs()).toBe(1);
  sessions = [...sessions, { id: "phone", label: "iPhone", scopes: ["admin", "client"] }];
  await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
  expect(host.querySelector("[data-phone-linked]")?.textContent).toContain("Your phone is in");
  await click("[data-phone-linked] [data-primary]");
  expect(host.textContent).toContain("Logs in with owner@example.test");
});

it("swaps the code for a new one a minute before it ends, so the screen never shows a dead code", async () => {
  await mount({ remote: false });
  await flush();
  expect(host.querySelector("[data-phone-code]")?.textContent).toBe("ABCD EFGH 0001");
  expect(host.textContent).toContain("A new code appears in 9 min");
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000 - RENEW_BEFORE_MS - 1_000); });
  expect(minted).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
  expect(minted).toBe(2);
  expect(host.querySelector("[data-phone-code]")?.textContent).toBe("ABCD EFGH 0002");
  expect(host.querySelector("[data-phone-qr]")?.getAttribute("data-phone-qr")).toContain("m=offer2&c=ABCDEFGH0002");
  expect(host.textContent).not.toContain("This code expired");
});

it("stops renewing after an hour or so and then says the code ended, with a new code one press away", async () => {
  await mount({ remote: false });
  await flush();
  for (let i = 0; i < AUTO_RENEWALS + 1; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
  expect(minted).toBe(1 + AUTO_RENEWALS);
  expect(host.textContent).toContain("This code expired");
  await click("[data-phone-new-code]");
  await flush();
  expect(minted).toBe(2 + AUTO_RENEWALS);
  expect(host.querySelector("[data-phone-code]")).not.toBeNull();
});

it("when no code can be made, says why with one way to try again, and shows no empty code to copy", async () => {
  const base = api.getMockImplementation()!;
  let refuse = true;
  api.mockImplementation(async (path: string, init?: unknown) => {
    if (path === "/api/mobile/pairing" && refuse) throw new Error("A phone cannot reach this workspace yet");
    return base(path, init);
  });
  await mount({ remote: false });
  await flush();
  expect(host.querySelector("[data-pairing-failed] [role=alert]")?.textContent).toContain("cannot reach");
  expect(host.querySelector("[data-phone-slab]")).toBeNull();
  expect(host.querySelector("[data-phone-copy]")).toBeNull();
  expect(host.textContent).not.toContain("Scan with your phone's camera");
  refuse = false;
  await click("[data-pairing-failed] [data-phone-new-code]");
  await flush();
  expect(host.querySelector("[data-phone-code]")?.textContent).toBe("ABCD EFGH 0001");
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
