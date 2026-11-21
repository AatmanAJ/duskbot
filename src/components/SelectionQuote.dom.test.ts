// @vitest-environment happy-dom
import { act, createElement, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { useQuoteRequests, withQuote } from "@/lib/quote-selection";
import { OwnMessageText } from "./OwnMessageText";
import { pillPosition, SelectionQuote, transcriptSelection } from "./SelectionQuote";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setLocale("en");

let root: Root;
let draft = "";
const transcript = createRef<HTMLDivElement>();

function Box() {
  const [text, setText] = useState("Before ");
  useQuoteRequests("thread-1", (selected) => { const next = withQuote(text, selected); setText(next); draft = next; });
  return createElement("textarea", { "aria-label": "Message Pepper", value: text, readOnly: true });
}

function Chat() {
  return createElement("main", null,
    createElement("div", { ref: transcript, role: "log" },
      createElement("p", { id: "reply" }, "The release can ship on Friday after the last check."),
      createElement("button", { id: "chip" }, "Copy")),
    createElement(SelectionQuote, { root: transcript, threadId: "thread-1" }),
    createElement(Box));
}

const flush = () => act(async () => { await new Promise((done) => requestAnimationFrame(() => done(undefined))); });

function select(node: Node, start: number, end: number) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

beforeEach(async () => {
  draft = "";
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root.render(createElement(Chat)); });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  document.getSelection()?.removeAllRanges();
});

describe("quoting selected text", () => {
  it("shows a Quote pill for text selected in a message, and puts it in the message box as a quote", async () => {
    expect(document.querySelector("[data-selection-quote]")).toBeNull();
    select(document.getElementById("reply")!.firstChild!, 4, 41);
    await flush();
    const pill = document.querySelector<HTMLButtonElement>("[data-selection-quote]")!;
    expect(pill.getAttribute("aria-label")).toBe("Quote in your reply");
    expect(pill.textContent).toContain("Quote");
    await act(async () => { pill.click(); });
    expect(draft).toBe("Before\n\n> release can ship on Friday after the\n\n");
    expect(document.getSelection()!.isCollapsed).toBe(true);
    await flush();
    expect(document.querySelector("[data-selection-quote]")).toBeNull();
  });

  it("quotes with Cmd+L or Ctrl+L, and leaves the chord alone with nothing selected", async () => {
    const chord = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { key: "l", bubbles: true, cancelable: true, ...init });
      document.dispatchEvent(event);
      return event;
    };
    expect(chord({ metaKey: true }).defaultPrevented).toBe(false);
    select(document.getElementById("reply")!.firstChild!, 0, 11);
    expect(chord({ ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    await act(async () => { expect(chord({ ctrlKey: true }).defaultPrevented).toBe(true); });
    expect(draft).toBe("Before\n\n> The release\n\n");
  });

  it("ignores selections in buttons and outside the conversation", async () => {
    select(document.getElementById("chip")!.firstChild!, 0, 4);
    expect(transcriptSelection(transcript.current, document.getSelection())).toBeNull();
    const outside = document.body.appendChild(document.createElement("p"));
    outside.textContent = "Somewhere else";
    select(outside.firstChild!, 0, 9);
    expect(transcriptSelection(transcript.current, document.getSelection())).toBeNull();
    await flush();
    expect(document.querySelector("[data-selection-quote]")).toBeNull();
  });
});

describe("the pill's place", () => {
  it("sits above the selection, drops below it near the top, and stays inside the window", () => {
    expect(pillPosition({ top: 300, bottom: 320, left: 400, right: 500 }, 60, { width: 1200 })).toEqual({ top: 260, center: 450 });
    expect(pillPosition({ top: 40, bottom: 60, left: 400, right: 500 }, 60, { width: 1200 }).top).toBe(68);
    expect(pillPosition({ top: 300, bottom: 320, left: 0, right: 20 }, 60, { width: 1200 }).center).toBe(68);
    expect(pillPosition({ top: 300, bottom: 320, left: 1190, right: 1200 }, 60, { width: 1200 }).center).toBe(1132);
  });
});

describe("a sent message with a quote", () => {
  it("draws its quoted lines as a quote and the rest as written", async () => {
    await act(async () => { root.render(createElement(OwnMessageText, { text: "> ship on Friday\n\nFriday works for me." })); });
    const quote = document.querySelector("[data-own-quote]")!;
    expect(quote.tagName).toBe("BLOCKQUOTE");
    expect(quote.textContent).toBe("ship on Friday");
    expect(document.body.textContent).toContain("Friday works for me.");
    expect(document.body.textContent).not.toContain(">");
  });
});
