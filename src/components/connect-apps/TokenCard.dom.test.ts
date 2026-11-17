// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), opened: [] as string[] }));
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (original) => ({ ...await original<typeof import("@/state/store")>(), api: fixture.api }))(importOriginal)));
vi.mock("@/lib/app-links", () => ({ openExternalLink: async (url: string) => { fixture.opened.push(url); } }));

import { TokenCard } from "./TokenCard";
import { useTokenApps } from "./use-token-apps";

let root: Root;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const card = () => document.querySelector<HTMLElement>("[data-token-app]")!;
const button = (text: string) => [...card().querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent === text)!;
const steps = () => [...card().querySelectorAll<HTMLElement>("[data-guide-step]")].map((step) => `${step.dataset.guideStep}:${step.dataset.state}`);
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const status = (native: Record<string, boolean> = {}, accounts: unknown[] = []) => ({ accounts, native });

function Harness({ app, preferToken }: { app: string; preferToken?: boolean }) {
  return createElement(TokenCard, { app, tokens: useTokenApps(), ...(preferToken ? { preferToken } : {}) });
}

async function mount(app: string, preferToken?: boolean) {
  root ??= createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(createElement(Harness, { app, ...(preferToken ? { preferToken } : {}) })); });
  await flush();
}

beforeEach(() => {
  fixture.opened = [];
  fixture.api.mockReset();
});
afterEach(() => { act(() => root.unmount()); root = undefined!; document.body.innerHTML = ""; });

describe("a token app's guide", () => {
  it("walks through open, make, paste: each step ticks, and a checked token ends on a happy mascot", async () => {
    let accounts: unknown[] = [];
    fixture.api.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === "/api/app-tokens/notion" && init?.method === "POST") {
        expect(JSON.parse(init.body!)).toEqual({ fields: { token: "ntn_secret" } });
        accounts = [{ id: "a1", app: "notion", label: "Acme", server: "notion", via: "token", connectedAt: "2026-11-13T00:00:00Z" }];
      }
      return status({}, accounts);
    });
    await mount("notion");
    expect(steps()).toEqual(["open:current", "make:next", "paste:next"]);
    expect(card().querySelector("[data-guide-step='open']")?.textContent).toContain("Open Notion and sign in.");
    await act(async () => { button("Open Notion").click(); });
    expect(fixture.opened).toEqual(["https://www.notion.so/profile/integrations"]);
    expect(steps()).toEqual(["open:done", "make:current", "paste:next"]);
    expect(button("Connect").disabled, "nothing pasted yet").toBe(true);
    await act(async () => { type(card().querySelector<HTMLInputElement>('input[type="password"]')!, "ntn_secret"); });
    expect(steps()).toEqual(["open:done", "make:done", "paste:current"]);
    await act(async () => { card().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(card().textContent).toContain("Acme");
    expect(card().querySelector("[data-guide-finished]")?.textContent).toBe("Notion is connected. Your bots can use it now.");
    expect(card().querySelector("form"), "the guide folds away once connected").toBeNull();
  });

  it("says why a token was refused", async () => {
    fixture.api.mockImplementation(async (_path: string, init?: { method?: string }) => {
      if (init?.method === "POST") throw new Error("The app didn't accept this token. Check it and try again.");
      return status();
    });
    await mount("clickup");
    await act(async () => { type(card().querySelector<HTMLInputElement>('input[type="password"]')!, "pk_bad"); });
    await act(async () => { card().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(card().querySelector('[role="alert"]')?.textContent).toBe("The app didn't accept this token. Check it and try again.");
  });

  it("signs in to Google Drive with a code: shows it and opens Google's page", async () => {
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/app-tokens/googledrive/device") return { handle: "h".repeat(32), userCode: "ABCD-EFGH", verificationUrl: "https://www.google.com/device", expiresIn: 1800, interval: 5 };
      return status({ googledrive: true });
    });
    await mount("googledrive");
    expect(card().querySelector("form"), "Drive has no token to paste").toBeNull();
    await act(async () => { button("Sign in with Google Drive").click(); });
    await flush();
    expect(steps()).toEqual(["sign-in:done", "code:current"]);
    expect(card().querySelector("[data-device-code]")?.textContent).toBe("ABCD-EFGH");
    button("Open Google Drive").click();
    expect(fixture.opened).toEqual(["https://www.google.com/device"]);
  });

  it("offers GitHub's sign-in first when this build has it, the token steps when the page picks them, and no switch of its own", async () => {
    fixture.api.mockImplementation(async () => status({ github: true }));
    await mount("github");
    expect(steps()).toEqual(["sign-in:current", "finish:next"]);
    expect(card().querySelector(".ca-link"), "the page's other ways hold the switch").toBeNull();
    await mount("github", true);
    expect(steps()).toEqual(["open:current", "make:next", "paste:next"]);
  });

  it("opens a browser sign-in's page right away, since it has no code to read", async () => {
    fixture.api.mockImplementation(async (path: string) => path === "/api/app-tokens/github/device"
      ? { handle: "h".repeat(32), verificationUrl: "https://github.com/login/oauth/authorize?x=1", expiresIn: 900, interval: 2 }
      : status({ github: true }));
    await mount("github");
    await act(async () => { button("Sign in with GitHub").click(); });
    await flush();
    expect(fixture.opened).toEqual(["https://github.com/login/oauth/authorize?x=1"]);
    expect(steps()).toEqual(["sign-in:done", "finish:current"]);
  });

  it("marks a refused account, and Reconnect signs in again in its place with replaces", async () => {
    let accounts: unknown[] = [{ id: "a1a1a1a1a1a1a1a1", app: "notion", label: "Acme", server: "notion", via: "device", connectedAt: "2026-11-13T00:00:00Z", needsReconnect: true }];
    const posted: unknown[] = [];
    fixture.api.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === "/api/app-tokens/notion/device" && init?.method === "POST") {
        posted.push(JSON.parse(init.body!));
        return { handle: "h".repeat(32), verificationUrl: "https://api.notion.com/v1/oauth/authorize?x=1", expiresIn: 900, interval: 1 };
      }
      if (path.startsWith("/api/app-tokens/device/")) {
        accounts = [{ id: "b2b2b2b2b2b2b2b2", app: "notion", label: "Acme", server: "notion", via: "device", connectedAt: "2026-11-13T01:00:00Z" }];
        return { status: "connected", account: accounts[0] };
      }
      return status({ notion: true }, accounts);
    });
    await mount("notion");
    expect(card().querySelector("[data-needs-reconnect]")?.textContent).toBe("Needs reconnecting");
    await act(async () => { button("Reconnect").click(); });
    await flush();
    expect(posted).toEqual([{ replaces: "a1a1a1a1a1a1a1a1" }]);
    expect(fixture.opened).toEqual(["https://api.notion.com/v1/oauth/authorize?x=1"]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1_100)); });
    await flush();
    expect(card().querySelector("[data-needs-reconnect]")).toBeNull();
    expect([...card().querySelectorAll("button")].some((one) => one.textContent === "reconnect")).toBe(false);
  });
});
