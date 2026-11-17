// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { sessionCheck, sessionEnded } from "@/lib/session-ended";
import { api } from "@/state/api";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { PlatformContext, webPlatform, type MobilePlatform } from "../platform";
import { ConnectionGate } from "./ConnectionGate";

vi.mock("@/components/Avatar", () => ({ MausAvatar: () => createElement("span") }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const record = (id: string, label: string): MobileConnectionRecord => ({
  id, environmentId: `env-${id}`, label, transport: "https", origin: `https://${id}.example.test`, sessionRef: `token.${id}`,
  capabilities: {} as MobileConnectionRecord["capabilities"], addedAt: 1, lastUsedAt: 1,
});
let host: HTMLDivElement, root: Root, platform: MobilePlatform, prefs: Map<string, string>;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  setLocale("en");
  host = document.createElement("div"); document.body.append(host);
  prefs = new Map([["dusk.mobile.connections.v1", JSON.stringify([record("mac", "Studio Mac"), record("vps", "Box")])], ["dusk.mobile.active.v1", "mac"]]);
  const secrets = new Map([["token.mac", "mac-token"], ["token.vps", "vps-token"]]);
  platform = { ...webPlatform(),
    prefs: { get: async (key) => prefs.get(key) ?? null, set: async (key, value) => { prefs.set(key, value); }, remove: async (key) => { prefs.delete(key); } },
    secrets: { get: async (key) => secrets.get(key) ?? null, set: async (key, value) => { secrets.set(key, value); }, remove: async (key) => { secrets.delete(key); } },
  };
  fetcher = vi.fn<typeof fetch>(); vi.stubGlobal("fetch", fetcher);
  // happy-dom has no EventSource; the installed transport wraps it
  vi.stubGlobal("EventSource", class {});
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const mount = () => act(async () => {
  root = createRoot(host);
  root.render(createElement(PlatformContext, { value: platform }, createElement(ConnectionGate, null, createElement("p", null, "home"))));
});
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });
const click = (text: string) => act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent?.includes(text))!.click(); });

it("an offline server at launch keeps the link, retries, and offers the other saved installations", async () => {
  fetcher.mockRejectedValue(new TypeError("offline"));
  await mount(); await settle();
  expect(host.querySelector("h1")?.textContent).toBe("Can't reach Studio Mac");
  expect(host.textContent).not.toContain("Link to your");
  expect(host.textContent).toContain("Box");
  expect(prefs.get("dusk.mobile.active.v1")).toBe("mac");

  fetcher.mockResolvedValue(new Response("{}"));
  await click("Try again"); await settle();
  expect(host.textContent).toBe("home");
});

it("switches to another saved installation from the unreachable screen", async () => {
  fetcher.mockImplementation(async (input) => String(input).startsWith("https://vps.") ? new Response("{}") : Promise.reject(new TypeError("offline")));
  await mount(); await settle();
  await click("Box"); await settle();
  expect(prefs.get("dusk.mobile.active.v1")).toBe("vps");
  expect(host.textContent).toBe("home");
});

it("a refused token still goes to pairing", async () => {
  fetcher.mockResolvedValue(new Response("{}", { status: 401 }));
  await mount(); await settle();
  expect(host.querySelector("h1")?.textContent).not.toContain("Can't reach");
  expect(prefs.get("dusk.mobile.active.v1")).toBeUndefined();
});

it("a phone removed on the computer while the app is open leaves for pairing at once, with the reason", async () => {
  fetcher.mockResolvedValue(new Response("{}"));
  await mount(); await settle();
  expect(host.textContent).toBe("home");

  fetcher.mockImplementation(async () => new Response('{"error":"unauthorized"}', { status: 401 }));
  await act(async () => { await api("/api/bots").catch(() => {}); await sessionCheck(); });
  await settle();
  expect(host.textContent).not.toBe("home");
  expect(host.textContent).toContain("This phone was unlinked");
  expect(prefs.get("dusk.mobile.active.v1")).toBeUndefined();
  expect(prefs.get("dusk.mobile.connections.v1")).not.toContain("Studio Mac");
  expect(sessionEnded()).toBe(false);
});

it("a refused request on a session that still answers changes nothing", async () => {
  fetcher.mockResolvedValue(new Response("{}"));
  await mount(); await settle();
  fetcher.mockImplementation(async (input) => String(input instanceof Request ? input.url : input).endsWith("/api/auth/session") ? new Response("{}") : new Response("{}", { status: 401 }));
  await act(async () => { await api("/api/bots").catch(() => {}); await sessionCheck(); });
  await settle();
  expect(host.textContent).toBe("home");
  expect(prefs.get("dusk.mobile.active.v1")).toBe("mac");
});

it("a dusk cloud asleep at launch opens on its chats and is woken, never the can't reach screen it could not leave", async () => {
  // the edge never wakes a cloud for a read, so the launch check only ever hears that it sleeps
  fetcher.mockImplementation(async (input, init) => {
    const method = (input instanceof Request ? input.method : init?.method) ?? "GET";
    return method === "GET" ? new Response("asleep", { status: 503, headers: { "x-dusk-cloud-power": "asleep", "retry-after": "5" } }) : new Response("{}");
  });
  await mount(); await settle();
  expect(host.textContent).toBe("home");
  const posts = fetcher.mock.calls.filter(([input, init]) => ((input instanceof Request ? input.method : init?.method) ?? "GET") === "POST");
  expect(posts.map(([input]) => String(input instanceof Request ? input.url : input))).toContain("https://mac.example.test/api/cloud/wake");
});
