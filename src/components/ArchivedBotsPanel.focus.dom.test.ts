// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: () => {} }) };
});

import { ArchivedBotsPanel } from "./ArchivedBotsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = (id: string, name: string): Bot => ({
  id, threadId: `thread-${id}`, name, title: "", description: "", notifications: true, color: "green",
  unread: false, hidden: true, modelSelection: { instanceId: "claude", model: "test" }, messages: [],
});

let host: HTMLDivElement, root: Root, opener: HTMLButtonElement;
beforeEach(() => {
  opener = document.createElement("button");
  opener.textContent = "Archived";
  document.body.append(opener);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; });

const tab = (shiftKey = false) => {
  const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};

it("Tab stays inside the Archived bots dialog instead of reaching the sidebar behind it", async () => {
  opener.focus();
  await act(async () => { root.render(createElement(ArchivedBotsPanel, { bots: [bot("waffle", "Waffle"), bot("crumpet", "Crumpet")], onClose: vi.fn(), onRestored: vi.fn() })); });
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  const controls = [...dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
  controls.at(-1)!.focus();
  const forward = tab();
  expect(forward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(controls[0]);
  const back = tab(true);
  expect(back.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(controls.at(-1));
});

it("closing the Archived bots dialog puts focus back where it was opened from", async () => {
  opener.focus();
  await act(async () => { root.render(createElement(ArchivedBotsPanel, { bots: [bot("waffle", "Waffle")], onClose: vi.fn(), onRestored: vi.fn() })); });
  expect(document.activeElement).not.toBe(opener);
  await act(async () => { root.render(createElement("div")); });
  expect(document.activeElement).toBe(opener);
});
