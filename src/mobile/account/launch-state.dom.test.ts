// @vitest-environment happy-dom
import { act, createElement, StrictMode, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { AccountGate, useMobileAccount } from "./AccountGate";
import { ConnectionGate } from "../connection/ConnectionGate";
import { ActiveConnection } from "../connection/active";
import { readOpenChat, rememberOpenChat } from "../open-chat-restore";
import { PlatformContext, webPlatform, type MobilePlatform } from "../platform";
import { INSTALLED_KEY } from "./install";
import { signOutPhone } from "./sign-out";

vi.mock("@/components/Avatar", () => ({ MausAvatar: () => createElement("span") }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNT = "https://dusk.bot";
const CLOUD = "https://d0123456789abcdef0123.dusk.bot";
const person = { id: "person", email: "person@example.com" };
const accountToken = `omc_${"t".repeat(43)}`;
const cloudRecord: MobileConnectionRecord = {
  id: "cloud", environmentId: "env-cloud", label: "my cloud", transport: "https", origin: CLOUD, sessionRef: "token.cloud", deviceId: "device-cloud",
  capabilities: {} as MobileConnectionRecord["capabilities"], addedAt: 1, lastUsedAt: 1,
};

let host: HTMLDivElement, root: Root | null, platform: MobilePlatform, prefs: Map<string, string>, secrets: Map<string, string>;
let accountAnswer: () => Promise<Response>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const session = () => json({ account: person, expiresAt: Date.now() + 86_400_000, clouds: [{ id: "c1", name: "my cloud", role: "owner", status: "ready", origin: CLOUD }], teams: [] });

/** each launch is a new platform object, as a new process is: nothing kept in memory from the last one */
function launchPlatform(kind: "ios" | "android" = "ios"): MobilePlatform {
  return { ...webPlatform(), native: true, kind,
    prefs: { get: async (key) => prefs.get(key) ?? null, set: async (key, value) => { prefs.set(key, value); }, remove: async (key) => { prefs.delete(key); }, keys: async () => [...prefs.keys()] },
    secrets: { get: async (key) => secrets.get(key) ?? null, set: async (key, value) => { secrets.set(key, value); }, remove: async (key) => { secrets.delete(key); } } };
}
const keepSignIn = () => secrets.set("dusk.account", JSON.stringify({ origin: ACCOUNT, token: accountToken, expiresAt: Date.now() + 86_400_000, account: person, deviceId: "phone" }));
const keepCloud = () => {
  prefs.set("dusk.mobile.connections.v1", JSON.stringify([cloudRecord]));
  prefs.set("dusk.mobile.active.v1", "cloud");
  secrets.set("token.cloud", "cloud-token");
};

beforeEach(() => {
  setLocale("en"); vi.stubEnv("VITE_DUSK_ALLOW_SIGNED_OUT", ""); vi.stubEnv("VITE_DUSK_ACCOUNT_ORIGIN", "");
  host = document.createElement("div"); document.body.append(host); root = null;
  prefs = new Map(); secrets = new Map(); sessionStorage.clear();
  accountAnswer = async () => session();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(ACCOUNT)) return accountAnswer();
    if (url.startsWith(CLOUD)) return json({});
    return json({}, 404);
  }));
  vi.stubGlobal("EventSource", class {});
  platform = launchPlatform();
});
afterEach(async () => { await act(async () => root?.unmount()); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** the app's inside: which account it shows, on which place, and the chat it would open again */
function Inside() {
  const account = useMobileAccount();
  const place = useContext(ActiveConnection);
  return createElement("p", { "data-inside": "" }, `${account?.account?.email ?? "signed out"} on ${place} chat ${readOpenChat(place)}`);
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 5)); });
const launch = async () => {
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(StrictMode, null, createElement(PlatformContext, { value: platform },
      createElement(AccountGate, null, createElement(ConnectionGate, null, createElement(Inside))))));
  });
  await settle();
};
const inside = () => host.querySelector("[data-inside]")?.textContent ?? null;
const heading = () => host.querySelector("h1")?.textContent ?? null;

describe("what a launch shows", () => {
  it.each(["ios", "android"] as const)("%s: an update from a build without the install marker opens signed in on its place at once, never as a reinstall", async (kind) => {
    platform = launchPlatform(kind);
    keepSignIn(); keepCloud();
    // an older build kept the open chat as a bare id
    sessionStorage.setItem("dusk.mobile.openChat", "nova");
    accountAnswer = () => new Promise<Response>(() => {});
    await launch();
    expect(inside()).toBe("person@example.com on cloud chat null");
    expect(prefs.get(INSTALLED_KEY)).toBe("1");
    expect(secrets.has("dusk.account")).toBe(true);
  });

  it.each(["ios", "android"] as const)("%s: an update holding a sign-in and other settings but no place is not a reinstall either: the account's places show at once", async (kind) => {
    platform = launchPlatform(kind);
    keepSignIn();
    prefs.set("dusk.mobile.signInOffer", "dismissed");
    accountAnswer = () => new Promise<Response>(() => {});
    await launch();
    expect(heading()).toBe("Pick a cloud");
    expect(inside()).toBeNull();
    expect(prefs.get("dusk.mobile.connections.v1")).toBeUndefined();
  });

  it("a real reinstall waits for the service before showing the kept sign-in, then lists the places and opens none by itself", async () => {
    keepSignIn();
    let answer: (value: Response) => void = () => {};
    accountAnswer = () => new Promise<Response>((resolve) => { answer = resolve; });
    await launch();
    expect(heading()).toBeNull();
    expect(inside()).toBeNull();
    accountAnswer = async () => session();
    await act(async () => { answer(session()); });
    await settle();
    expect(heading()).toBe("Pick a cloud");
    expect(prefs.get("dusk.mobile.connections.v1")).toBeUndefined();
  });

  it("a reinstall whose kept sign-in the service no longer knows starts on the first screen, signed out", async () => {
    keepSignIn();
    accountAnswer = async () => json({ error: "invalid_token", code: "invalid_token" }, 401);
    await launch();
    expect(heading()).toBe("Your bots, on your phone");
    expect(secrets.has("dusk.account")).toBe(false);
  });

  it("after Sign out the next launch is the first screen, with no chat to reopen", async () => {
    keepSignIn(); keepCloud(); prefs.set(INSTALLED_KEY, "1");
    rememberOpenChat("nova", "cloud");
    await signOutPhone({ platform, signOutAccount: async () => { secrets.delete("dusk.account"); }, fetch: async () => json({}) });
    platform = launchPlatform();
    await launch();
    expect(heading()).toBe("Your bots, on your phone");
    expect(inside()).toBeNull();
    expect(readOpenChat("cloud")).toBeNull();
  });

  it("a cold start opens signed in on its place and reopens only the chat it kept for that place", async () => {
    keepSignIn(); keepCloud(); prefs.set(INSTALLED_KEY, "1");
    rememberOpenChat("nova", "cloud");
    accountAnswer = () => new Promise<Response>(() => {});
    await launch();
    expect(inside()).toBe("person@example.com on cloud chat nova");
    rememberOpenChat("nova", "other-place");
    expect(readOpenChat("cloud")).toBeNull();
  });
});
