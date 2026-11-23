// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ answer: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/api", () => ({ api: vi.fn(() => server.answer!()) }));

import { initialState, StoreContext, type AppState } from "@/state/store";
import { closeInbox, openInbox, refreshInbox, setInboxView } from "@/state/inbox";
import { InboxPanel } from "./InboxPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
beforeEach(() => {
  setInboxView(null);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; closeInbox(); });

const mount = () => act(async () => {
  root.render(createElement(StoreContext.Provider,
    { value: { state: { ...initialState, bots: [] } as AppState, dispatch: vi.fn(), flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() } as never },
    createElement(InboxPanel)));
});
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const list = () => document.querySelector<HTMLElement>("[data-inbox-list]")?.parentElement?.textContent ?? document.body.textContent ?? "";

it("an inbox that could not be read says so with Try again, and Try again reads it", async () => {
  server.answer = () => Promise.reject(Object.assign(new Error("Server error"), { status: 500 }));
  openInbox();
  await refreshInbox();
  await mount();
  await settle();
  expect(list()).not.toContain("Nothing for you yet.");
  const retry = [...document.querySelectorAll("button")].find((button) => button.textContent === "Try again");
  expect(retry).toBeTruthy();
  server.answer = async () => ({ rows: [] });
  await act(async () => { retry!.click(); });
  await settle();
  expect(list()).toContain("Nothing for you yet.");
});

// last: its read never answers, and the inbox store keeps waiting on it
it("while the inbox is still being read it does not say there is nothing for you", async () => {
  server.answer = () => new Promise(() => {});
  openInbox();
  void refreshInbox();
  await mount();
  await settle();
  expect(list()).not.toContain("Nothing for you yet.");
});
