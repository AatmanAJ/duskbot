// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (original) => ({ ...await original<typeof import("@/state/store")>(), api: fixture.api }))(importOriginal)));

import { RemoteAccounts } from "./AppPage";
import { needsReconnect } from "./use-remote-apps";
import type { DirectoryApp } from "../../../shared/connector-directory";

let root: Root | undefined;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-remote-account]")].map((row) => row.textContent);
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent === text);
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

let choices = { defaults: {} as Record<string, string>, bots: {} as Record<string, Record<string, string>> };
const calls = { reconnect: [] as string[], add: [] as string[] };

async function mount(accounts: Parameters<typeof RemoteAccounts>[0]["accounts"]) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  const remote = { open: false, busy: false, appId: "notion", accounts, bots: [{ id: "nova", name: "Nova" }],
    onConnect: () => {}, onCancel: () => {}, onManage: () => {},
    onReconnect: (server: string) => calls.reconnect.push(server), onAddAccount: (account: string) => calls.add.push(account) };
  await act(async () => { root!.render(createElement(RemoteAccounts, { remote, name: "Notion", accounts })); });
  await flush();
}

beforeEach(() => {
  choices = { defaults: {}, bots: {} };
  calls.reconnect = [];
  calls.add = [];
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body!) as { accountId: string | null; botId?: string };
      const slug = path.split("/")[3]!;
      const target = body.botId ? (choices.bots[body.botId] ??= {}) : choices.defaults;
      if (body.accountId) target[slug] = body.accountId; else delete target[slug];
    }
    return choices;
  });
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

describe("a vendor app's accounts", () => {
  it("knows an entry to sign in to again: turned on, an OAuth app, and its sign-in gone", () => {
    const app = { id: "notion", auth: "oauth" } as DirectoryApp;
    const entry = { name: "notion", type: "http" as const, url: "https://mcp.notion.com/mcp", headerKeys: [], enabled: true };
    expect(needsReconnect(app, { ...entry, auth: "needs-sign-in" })).toBe(true);
    expect(needsReconnect(app, { ...entry, enabled: false, auth: "needs-sign-in" }), "never signed in yet").toBe(false);
    expect(needsReconnect(app, { ...entry, auth: "signed-in" })).toBe(false);
  });

  it("marks one that needs reconnecting, and Reconnect signs that same entry in again", async () => {
    await mount([{ name: "notion", signedIn: false, stale: true }]);
    expect(rows()).toEqual(["NotionNeeds reconnectingReconnect"]);
    await act(async () => { button("Reconnect")!.click(); });
    expect(calls.reconnect).toEqual(["notion"]);
  });

  it("adds another account by name, keeping the first as every bot's default", async () => {
    await mount([{ name: "notion", signedIn: true, stale: false }]);
    await act(async () => { button("Add another account")!.click(); });
    await act(async () => { type(document.querySelector<HTMLInputElement>(".ca-alias input")!, "Work"); });
    await act(async () => { document.querySelector(".ca-alias")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(calls.add).toEqual(["Work"]);
    expect(choices.defaults).toEqual({ "mcp-notion": "notion" });
  });

  it("with two working accounts, names each, marks the default, and lets each bot pick one", async () => {
    choices.defaults["mcp-notion"] = "notion";
    await mount([{ name: "notion", signedIn: true, stale: false }, { name: "notion-2", account: "Work", signedIn: true, stale: false }]);
    expect(rows()).toEqual(["NotionDefault", "WorkMake default"]);
    const select = document.querySelector<HTMLSelectElement>("[data-account-bot='nova'] select")!;
    expect([...select.options].map((option) => option.textContent)).toEqual(["Default (Notion)", "Notion", "Work"]);
    await act(async () => { select.value = "notion-2"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(choices.bots).toEqual({ nova: { "mcp-notion": "notion-2" } });
  });
});
