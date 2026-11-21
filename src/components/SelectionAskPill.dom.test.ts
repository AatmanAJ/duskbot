// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { SelectionAskPill } from "./SelectionAskPill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, page: HTMLDivElement, root: Root;
const onAsk = vi.fn();
const pill = () => document.querySelector<HTMLButtonElement>("[data-selection-ask]");
const shown = () => Boolean(pill() && pill()!.getAttribute("aria-hidden") !== "true");

beforeEach(async () => {
  onAsk.mockReset();
  page = document.createElement("div");
  page.innerHTML = `
    <div data-quotable=""><p>Here is a plan.</p><ol><li><strong>Wednesday</strong>: record the video.</li></ol></div>
    <div data-own><p>What should we do?</p></div>
    <div data-tour="composer"><div data-quotable=""><textarea>typed words</textarea></div></div>`;
  document.body.append(page);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(SelectionAskPill, { onAsk })); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  page.remove();
  window.getSelection()?.removeAllRanges();
});

async function select(start: Node, startAt: number, end: Node, endAt: number) {
  const range = document.createRange();
  range.setStart(start, startAt);
  range.setEnd(end, endAt);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await act(async () => {
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await new Promise((done) => requestAnimationFrame(() => done(null)));
  });
}

describe("Ask about this", () => {
  it("appears for words selected in a bot's message, markdown included, and quotes just them", async () => {
    expect(shown()).toBe(false);
    const strong = page.querySelector("strong")!.firstChild!;
    const rest = page.querySelector("li")!.lastChild!;
    await select(strong, 0, rest, 8);
    expect(shown()).toBe(true);
    expect(pill()!.textContent).toContain("Ask about this");
    await act(async () => { pill()!.click(); });
    expect(onAsk).toHaveBeenCalledWith("Wednesday: record");
    expect(window.getSelection()!.isCollapsed).toBe(true);
    expect(shown()).toBe(false);
  });

  it("quotes the selection with the keyboard shortcut", async () => {
    const text = page.querySelector("p")!.firstChild!;
    await select(text, 0, text, 7);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", metaKey: isMacPlatform(), ctrlKey: !isMacPlatform(), bubbles: true, cancelable: true }));
    });
    expect(onAsk).toHaveBeenCalledWith("Here is");
  });

  it("stays away from the person's own message, the composer and a selection that leaves the message", async () => {
    const own = page.querySelector("[data-own] p")!.firstChild!;
    await select(own, 0, own, 4);
    expect(shown()).toBe(false);
    const composer = page.querySelector("[data-tour=composer] > div")!;
    await select(composer, 0, composer, 1);
    expect(shown()).toBe(false);
    const bot = page.querySelector("p")!.firstChild!;
    await select(bot, 0, own, 4);
    expect(shown()).toBe(false);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", metaKey: isMacPlatform(), ctrlKey: !isMacPlatform(), bubbles: true, cancelable: true }));
    });
    expect(onAsk).not.toHaveBeenCalled();
  });
});
