// @vitest-environment happy-dom
import { createElement, StrictMode, useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TableDialog } from "./RichTable";

function Opener() {
  const [open, setOpen] = useState(false);
  return createElement("div", null,
    createElement("button", { type: "button", onClick: () => setOpen(true) }, "Preview"),
    open && createElement(TableDialog, { title: "q3-hours.csv", returnFocus: null, onClose: () => setOpen(false), children: "rows" }));
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

// happy-dom fires a dialog's close event inside close(); browsers queue it as a task (HTML "close the dialog"), so it
// arrives after StrictMode has mounted the dialog again.
const nativeClose = HTMLDialogElement.prototype.close;
function closeWithBrowserTiming(this: HTMLDialogElement, value?: string) {
  if (!this.open) return;
  const dispatch = this.dispatchEvent;
  this.dispatchEvent = () => true;
  try {
    nativeClose.call(this, value);
  } finally {
    this.dispatchEvent = dispatch;
  }
  setTimeout(() => this.dispatchEvent(new Event("close")));
}

describe("the preview dialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeAll(() => { HTMLDialogElement.prototype.close = closeWithBrowserTiming; });
  afterAll(() => { HTMLDialogElement.prototype.close = nativeClose; });
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("stays open under StrictMode's mount, unmount and mount, and still closes on its X and on Escape", async () => {
    act(() => root.render(createElement(StrictMode, null, createElement(Opener))));
    const open = async () => {
      act(() => host.querySelector("button")!.click());
      await settle();
      return document.querySelector("dialog");
    };

    const dialog = await open();
    expect(dialog?.open).toBe(true);

    act(() => dialog!.querySelector<HTMLButtonElement>("button[aria-label]")!.click());
    await settle();
    expect(document.querySelector("dialog")).toBeNull();

    const again = await open();
    expect(again?.open).toBe(true);
    act(() => { again!.dispatchEvent(new Event("cancel")); });
    await settle();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
