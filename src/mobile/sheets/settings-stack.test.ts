// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetStack } from "../Sheet";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("a sheet page inside Settings' stack", () => {
  it("draws in place with a back that pops the stack, never a second dialog over Settings", () => {
    const back = vi.fn();
    const onClose = vi.fn();
    act(() => root.render(createElement(SheetStack, { value: { back } }, createElement(Sheet, { open: true, onClose, title: "Notifications" }, createElement("p", null, "caught up")))));
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(host.textContent).toContain("Notifications");
    expect(host.textContent).toContain("caught up");
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Back']")!.click());
    expect(back).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps a page's own inner back (a vault entry) ahead of the stack's", () => {
    const back = vi.fn();
    const inner = vi.fn();
    act(() => root.render(createElement(SheetStack, { value: { back } }, createElement(Sheet, { open: true, onClose() {}, title: "Login", back: inner }, null))));
    act(() => host.querySelector<HTMLButtonElement>("button[aria-label='Back']")!.click());
    expect(inner).toHaveBeenCalledOnce();
    expect(back).not.toHaveBeenCalled();
  });
});
