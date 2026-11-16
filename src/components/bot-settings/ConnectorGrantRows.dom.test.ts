// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { SubPageContext } from "../ListRows";
import { ConnectorGrantPage, ConnectorGrantRows } from "./ConnectorGrantRows";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (original) => ({ ...await original<typeof import("@/state/store")>(), api }))(importOriginal)));

let root: Root | null = null;
afterEach(() => {
  flushSync(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  api.mockReset();
});

function mount(node: ReturnType<typeof createElement>, open = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(SubPageContext.Provider, { value: { at: "grants", open, back: () => {} } }, node)));
  return { host, open };
}

const bot = (connectorTools?: Bot["connectorTools"]) => ({ id: "scout", name: "Scout", connectorTools }) as Bot;
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-sheet-row]")].map((row) => row.dataset.sheetRow);

describe("per-app tools as rows", () => {
  it("lists each connected app with what it may use, each opening its own page", () => {
    const patch = vi.fn();
    const { host, open } = mount(createElement(ConnectorGrantRows, { bot: bot({ gmail: { tools: ["GMAIL_SEND_EMAIL"] } } as Bot["connectorTools"]), patch, slugs: ["gmail", "slack"] }));
    expect(rows(host)).toEqual(["grant:gmail", "grant:slack", "grants-reset"]);
    expect(host.textContent).toContain("Tools: 1");
    expect(host.textContent).toContain("No tools");
    host.querySelector<HTMLButtonElement>('[data-sheet-row="grant:gmail"]')!.click();
    expect(open).toHaveBeenCalledWith("grant:gmail", "gmail");
    host.querySelector<HTMLButtonElement>('[data-sheet-row="grants-reset"]')!.click();
    expect(patch).toHaveBeenCalledWith({ connectorTools: null });
    expect(host.querySelector("Details, input[type=checkbox]")).toBeNull();
  });

  it("says so when no app is connected, and offers no reset without a grants record", () => {
    const { host } = mount(createElement(ConnectorGrantRows, { bot: bot(), patch: vi.fn(), slugs: [] }));
    expect(host.textContent).toContain("No apps connected yet.");
    expect(rows(host)).toEqual([]);
  });

  it("an app's page checks its tools one by one", async () => {
    api.mockResolvedValue({ configured: true, services: { gmail: [{ name: "GMAIL_FETCH_EMAILS" }, { name: "GMAIL_SEND_EMAIL" }] } });
    const patch = vi.fn();
    const { host } = mount(createElement(ConnectorGrantPage, { bot: bot({ gmail: { tools: ["GMAIL_FETCH_EMAILS"] } } as Bot["connectorTools"]), patch, slug: "gmail", slugs: ["gmail"] }));
    await vi.waitFor(() => expect(host.querySelector('[data-sheet-row="tool:GMAIL_SEND_EMAIL"]')).not.toBeNull());
    expect(host.querySelector('[data-sheet-row="tool:GMAIL_FETCH_EMAILS"]')!.getAttribute("aria-checked")).toBe("true");
    host.querySelector<HTMLButtonElement>('[data-sheet-row="tool:GMAIL_SEND_EMAIL"]')!.click();
    expect(patch).toHaveBeenLastCalledWith({ connectorTools: { gmail: { tools: ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"] } } });
  });
});
