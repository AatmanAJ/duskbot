// @vitest-environment happy-dom
// #352: a phone signed in with a plain link was asked for notifications it could never get, and nobody said why
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MobileConnectionRecord } from "../../../shared/mobile-link";
import { PlatformContext, type MobilePlatform } from "../platform";
import { NotificationSettings } from "../sheets/NotificationSettings";
import { CONNECTIONS_KEY } from "./connections";
import { ensurePairedPhone, registerPushForConnection, sendTestPush } from "./push";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let n = 0;
function phone(record: Partial<MobileConnectionRecord> = {}) {
  const id = `place-${++n}`;
  const prefs = new Map<string, string>([[CONNECTIONS_KEY, JSON.stringify([{ id, environmentId: "env-1", label: "Ram's server", transport: "https", origin: "https://dusk.example", sessionRef: `token.${id}`, capabilities: {}, addedAt: 1, lastUsedAt: 1, ...record }])], ["dusk.mobile.active.v1", id]]);
  const secrets = new Map<string, string>([[`token.${id}`, "bearer"]]);
  const registerPush = vi.fn(async () => ({ token: "a".repeat(64), platform: "apns" as const }));
  const platform = {
    native: true, kind: "ios", appVersion: "1.2.13", deviceName: () => "Ram's iPhone", registerPush,
    pushPermission: async () => "granted" as const,
    prefs: { get: async (key: string) => prefs.get(key) ?? null, set: async (key: string, value: string) => { prefs.set(key, value); }, remove: async (key: string) => { prefs.delete(key); } },
    secrets: { get: async (key: string) => secrets.get(key) ?? null, set: async (key: string, value: string) => { secrets.set(key, value); }, remove: async (key: string) => { secrets.delete(key); } },
  } as unknown as MobilePlatform;
  return { platform, registerPush, prefs, id };
}

/** a place answering the phone routes: `adopts` false is a server too old to have them */
function place({ adopts = true, paired = false }: { adopts?: boolean; paired?: boolean } = {}) {
  const calls: string[] = [];
  let device = paired;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push(`${method} ${url}`);
    if (url === "/api/mobile/device" && method === "GET") return device ? Response.json({ device: { id: "dev-1", push: null } }) : adopts ? Response.json({ error: "this session is not a paired phone", code: "not_paired" }, { status: 404 }) : Response.json({ error: "this session is not a paired phone" }, { status: 404 });
    if (url === "/api/mobile/device" && method === "POST") { if (!adopts) return new Response("not found", { status: 404 }); device = true; return Response.json({ device: { id: "dev-1", push: null } }); }
    if (url === "/api/mobile/push" && method === "PUT") return device ? Response.json({ ok: true, delivering: true }) : Response.json({ code: "not_paired" }, { status: 403 });
    if (url === "/api/mobile/push/test") return Response.json({ relay: "https://link.dusk.bot", results: [{ id: "dev-1", name: "Ram's iPhone", platform: "ios", service: "apns", outcome: "sent" }] });
    return new Response("{}", { status: 404 });
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("push on a phone that only signed in", () => {
  it("makes itself a paired phone first, then asks for notifications and registers", async () => {
    const { platform, registerPush, prefs, id } = phone();
    const calls = place();
    await registerPushForConnection(platform, { prompt: true });
    expect(calls).toEqual(["GET /api/mobile/device", "POST /api/mobile/device", "PUT /api/mobile/push"]);
    expect(registerPush).toHaveBeenCalledWith({ prompt: true });
    expect(JSON.parse(prefs.get(CONNECTIONS_KEY)!)[0]).toMatchObject({ id, deviceId: "dev-1" });
    expect(await sendTestPush(platform)).toBe("sent");
  });

  it("never asks the system for notifications on a place too old to push to it", async () => {
    const { platform, registerPush } = phone();
    const calls = place({ adopts: false });
    await registerPushForConnection(platform, { prompt: true });
    expect(registerPush).not.toHaveBeenCalled();
    expect(calls).toEqual(["GET /api/mobile/device"]);
    expect(await ensurePairedPhone(platform)).toBeNull();
  });

  it("shows the card with the fix in Settings, and the fix pairs the phone", async () => {
    const { platform, registerPush } = phone();
    place({ adopts: false });
    await ensurePairedPhone(platform);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(PlatformContext.Provider, { value: platform }, createElement(NotificationSettings))); });
    const card = host.querySelector("[data-push-not-paired]");
    expect(card?.textContent).toContain("Notifications can't reach this phone");
    expect(card?.textContent).toContain("too old");
    expect(host.textContent).not.toContain("Allow notifications");
    // the server is updated: Try again pairs the phone and the card gives way to the test row
    place();
    await act(async () => { card!.querySelector("button")!.click(); });
    await vi.waitFor(() => expect(registerPush).toHaveBeenCalled());
    await vi.waitFor(() => expect(host.querySelector("[data-push-not-paired]")).toBeNull());
    expect(host.textContent).toContain("Send a test notification");
    act(() => root.unmount());
    host.remove();
  });
});
