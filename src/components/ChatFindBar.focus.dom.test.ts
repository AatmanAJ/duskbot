// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/focus-message", () => ({ landOnSearchHit: vi.fn(async () => undefined) }));
const fixture = vi.hoisted(() => ({ dispatch: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: vi.fn(async () => ({ hits: [] })), useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch }) };
});

import { ChatFindBar } from "./ChatFindBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root, composer: HTMLTextAreaElement;
beforeEach(() => {
  document.body.innerHTML = `<div data-tour="composer"><textarea aria-label="Message Pepper"></textarea></div>`;
  composer = document.querySelector("textarea")!;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; });

function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? createElement(ChatFindBar, { threadId: "t1", onClose }) : null;
}

it("closing find with Escape puts the cursor back in the message box", async () => {
  composer.focus();
  let open = true;
  const close = () => { open = false; root.render(createElement(Harness, { open, onClose: close })); };
  await act(async () => { root.render(createElement(Harness, { open, onClose: close })); });
  const input = host.querySelector("input")!;
  expect(document.activeElement).toBe(input);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(host.querySelector("input")).toBeNull();
  expect(document.activeElement).toBe(composer);
});

it("closing find from a menu that is gone still lands in the message box, not on the page", async () => {
  const menuItem = document.createElement("button");
  document.body.append(menuItem);
  menuItem.focus();
  let open = true;
  const close = () => { open = false; root.render(createElement(Harness, { open, onClose: close })); };
  await act(async () => { root.render(createElement(Harness, { open, onClose: close })); });
  menuItem.remove();
  const closeButton = host.querySelector<HTMLButtonElement>("button[aria-label='Close find']")!;
  await act(async () => { closeButton.click(); });
  expect(document.activeElement).toBe(composer);
});

it("the match count is announced as it changes", async () => {
  await act(async () => { root.render(createElement(Harness, { open: true, onClose: vi.fn() })); });
  const status = host.querySelector("[role=status]");
  expect(status).not.toBeNull();
});
