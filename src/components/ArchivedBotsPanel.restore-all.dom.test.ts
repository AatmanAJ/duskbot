// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  api: vi.fn(),
  openBot: vi.fn(),
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: fixture.api,
    openBot: fixture.openBot,
    useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch }),
  };
});

import { ArchivedBotsPanel } from "./ArchivedBotsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = (id: string, name: string): Bot => ({
  id, threadId: `thread-${id}`, name, title: "", description: "", notifications: true, color: "green",
  unread: false, hidden: true, modelSelection: { instanceId: "claude", model: "test" }, messages: [],
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); document.body.innerHTML = ""; });

it("restore all keeps the bots it did restore when another one fails, and names the one left", async () => {
  const waffle = bot("waffle", "Waffle");
  const crumpet = bot("crumpet", "Crumpet");
  fixture.api.mockImplementation(async (path: string) => {
    if (path.includes("crumpet")) throw new Error("Bot is busy");
    return { bot: { ...waffle, hidden: false } };
  });
  const onClose = vi.fn();
  await act(async () => {
    root.render(createElement(ArchivedBotsPanel, { bots: [waffle, crumpet], onClose, onRestored: vi.fn() }));
  });
  const restoreAll = [...document.querySelectorAll("button")].find((button) => button.textContent === "Restore all")!;
  await act(async () => { restoreAll.click(); });

  expect(fixture.dispatch).toHaveBeenCalledWith({ type: "botPatched", bot: expect.objectContaining({ id: "waffle", hidden: false }) });
  const alert = document.querySelector("[role=alert]");
  expect(alert?.textContent).toContain("Crumpet");
  expect(onClose).not.toHaveBeenCalled();
});
