// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });

const mount = async (pending: boolean, onCancel: () => void) => {
  await act(async () => {
    root.render(createElement(ConfirmDialog, {
      open: true, title: "Move Waffle?", body: "It moves to the team.", confirmLabel: "Move", tone: "neutral",
      pending, onCancel, onConfirm: vi.fn(),
    }));
  });
};

it("Escape does not walk away from a confirm whose action is still running", async () => {
  const onCancel = vi.fn();
  await mount(true, onCancel);
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(onCancel).not.toHaveBeenCalled();
});

it("a click outside does not walk away from a confirm whose action is still running", async () => {
  const onCancel = vi.fn();
  await mount(true, onCancel);
  const backdrop = document.querySelector<HTMLElement>(".fixed.inset-0")!;
  await act(async () => { backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  expect(onCancel).not.toHaveBeenCalled();
});

it("Escape still cancels once nothing is running", async () => {
  const onCancel = vi.fn();
  await mount(false, onCancel);
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(onCancel).toHaveBeenCalledTimes(1);
});
