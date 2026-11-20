// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { revealSidebarRow } from "./sidebar-reveal";

function sidebar(): HTMLElement {
  const root = document.createElement("aside");
  root.innerHTML = `
    <div data-sidebar-bot-row="nova" role="button"></div>
    <div data-sidebar-bot-row='bot "quoted"' role="button"></div>
    <div data-sidebar-group-row="room-1" role="button"></div>`;
  document.body.append(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("revealSidebarRow", () => {
  it("scrolls the open bot's row just into view", () => {
    const root = sidebar();
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(function (this: HTMLElement) {});
    expect(revealSidebarRow(root, "nova")).toBe(true);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(root.querySelector('[data-sidebar-bot-row="nova"]'));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("finds an open group chat and an id that needs escaping", () => {
    const root = sidebar();
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    expect(revealSidebarRow(root, "room-1")).toBe(true);
    expect(revealSidebarRow(root, 'bot "quoted"')).toBe(true);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("does nothing with no open chat or a row that is not drawn", () => {
    const root = sidebar();
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    expect(revealSidebarRow(root, null)).toBe(false);
    expect(revealSidebarRow(root, "archived-bot")).toBe(false);
    expect(revealSidebarRow(null, "nova")).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
  });
});
