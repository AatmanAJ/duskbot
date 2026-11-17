// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/feedback-sheet", async (actual) => ({
  ...await actual<typeof import("@/lib/feedback-sheet")>(),
  feedbackImage: vi.fn(async (file: File) => file.type === "text/plain"
    ? { ok: false, problem: "format" }
    : { ok: true, image: { blob: file, url: `blob:${file.name}` } }),
}));

import { ApiError } from "@/state/api";

import { FeedbackDialog } from "./FeedbackDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
const send = vi.fn(async () => ({ id: "dr-abcdefghjk" }));
const onClose = vi.fn(), onSent = vi.fn();
beforeEach(() => {
  URL.revokeObjectURL = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

const $ = <T extends Element>(selector: string) => document.body.querySelector<T>(selector);
const sendButton = () => $<HTMLButtonElement>("[data-feedback-send]")!;
const mount = async () => { await act(async () => { root.render(createElement(FeedbackDialog, { onClose, onSent, send })); }); };
async function type(text: string) {
  const field = $<HTMLTextAreaElement>("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(...files: File[]) {
  const input = $<HTMLInputElement>("[data-feedback-images-input]")!;
  const live = [...files];
  Object.defineProperty(input, "files", { configurable: true, get: () => live });
  Object.defineProperty(input, "value", { configurable: true, get: () => "", set: () => { live.length = 0; } });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}
const picture = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

describe("the Give feedback sheet", () => {
  it("has a labelled field, no email question, and Send off while it is empty", async () => {
    await mount();
    const dialog = $('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.textContent).toContain("Give feedback");
    expect(dialog.textContent).toContain("What happened, or what would you change?");
    expect(dialog.textContent).toContain("Goes to the dusk bot team");
    expect(dialog.textContent?.toLowerCase()).not.toContain("email");
    expect($('[role="switch"]')).toBeNull();
    expect(sendButton().disabled).toBe(true);
    await type("   ");
    expect(sendButton().disabled).toBe(true);
    await type("Connect apps opened behind the chat");
    expect(sendButton().disabled).toBe(false);
  });

  it("adds pictures as thumbnails, each with its own remove, and at most three", async () => {
    await mount();
    await choose(picture("a.png"), picture("b.png"));
    const thumbs = () => [...document.body.querySelectorAll<HTMLImageElement>("[data-feedback-image] img")];
    expect(thumbs().map((image) => image.alt)).toEqual(["Attached image 1", "Attached image 2"]);
    const remove = $<HTMLButtonElement>('[aria-label="Remove image 1"]')!;
    await act(async () => { remove.click(); });
    expect(thumbs().map((image) => image.getAttribute("src"))).toEqual(["blob:b.png"]);
    await choose(picture("c.png"), picture("d.png"), picture("e.png"));
    expect(thumbs()).toHaveLength(3);
    expect($('[role="alert"]')?.textContent).toBe("You can add up to 3 images.");
    expect($("[data-feedback-add-images]")).toBeNull();
  });

  it("says why a file can't be used", async () => {
    await mount();
    await choose(new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect($('[role="alert"]')?.textContent).toBe("Use a PNG, JPEG or WebP picture.");
  });

  it("sends the words and pictures, then closes; a failure keeps everything and says so", async () => {
    await mount();
    await type("  It froze  ");
    await choose(picture("a.png"));
    send.mockRejectedValueOnce(new Error("Couldn't reach dusk bot. Check your connection and try again."));
    await act(async () => { sendButton().click(); });
    expect($('[role="alert"]')?.textContent).toBe("Couldn't reach dusk bot. Check your connection and try again.");
    expect(onSent).not.toHaveBeenCalled();
    expect(sendButton().disabled).toBe(false);
    await act(async () => { sendButton().click(); });
    expect(send).toHaveBeenLastCalledWith("It froze", [expect.objectContaining({ url: "blob:a.png" })]);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  // a server older than the feedback route answered "no route: POST /api/feedback", shown as is (#9)
  it("says the server is too old when it has no feedback route, keeping what was written", async () => {
    await mount();
    await type("It froze");
    send.mockRejectedValueOnce(new ApiError("no route: POST /api/feedback", 404, { error: "no route: POST /api/feedback" }));
    await act(async () => { sendButton().click(); });
    const alert = $('[role="alert"]')?.textContent ?? "";
    expect(alert).toContain("This server is too old to take feedback");
    expect(alert).not.toContain("no route");
    expect($<HTMLTextAreaElement>("textarea")!.value).toBe("It froze");
    expect(sendButton().disabled).toBe(false);
  });

  it("Cancel and Escape close it", async () => {
    await mount();
    const cancel = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!;
    await act(async () => { cancel.click(); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
