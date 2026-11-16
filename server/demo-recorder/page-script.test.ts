import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

import type { DemoTarget } from "../../shared/demo-recording.ts";
import type { DemoDrain, RawDemoEvent } from "./events.ts";
import {
  DEMO_MARK, DEMO_PAGE_SCRIPT, demoActExpression, demoDrainExpression, demoFindExpression, demoPageStateExpression, demoUnmarkExpression,
  type DemoFound, type DemoPageState,
} from "./page-script.ts";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const step of cleanup.splice(0)) await step(); });

type Field = { value: string; type: string; checked: boolean; dispatchEvent(event: unknown): boolean; focus(): void; getAttribute(name: string): string | null; id: string };

/** A document in happy-dom with the recorder installed. */
function page(html: string, { install = true, url = "https://portal.example/expenses/new" } = {}) {
  const window = new Window({ url, settings: { disableJavaScriptEvaluation: false } });
  window.document.body.innerHTML = html;
  cleanup.push(() => window.happyDOM.close());
  if (install) window.eval(DEMO_PAGE_SCRIPT);
  const $ = (selector: string) => window.document.querySelector(selector) as unknown as Field;
  return {
    window,
    $,
    drain: () => JSON.parse(window.eval(demoDrainExpression()) as string) as DemoDrain,
    click: (selector: string) => $(selector).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 412, clientY: 96 })),
    /** Types as a browser delivers it: a key and an input event for each character. */
    type: (selector: string, text: string) => {
      const field = $(selector);
      field.focus();
      for (const char of text) {
        field.dispatchEvent(new window.KeyboardEvent("keydown", { key: char, bubbles: true }));
        field.value += char;
        field.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: char, inputType: "insertText" }));
        field.dispatchEvent(new window.KeyboardEvent("keyup", { key: char, bubbles: true }));
      }
      field.dispatchEvent(new window.Event("change", { bubbles: true }));
    },
    find: (target: DemoTarget, options: { kind: Parameters<typeof demoFindExpression>[1]["kind"]; value?: string }, nonce = "n1") =>
      JSON.parse(window.eval(demoFindExpression(target, { ...options, nonce })) as string) as DemoFound,
    act: (nonce: string, action: Parameters<typeof demoActExpression>[1]) => JSON.parse(window.eval(demoActExpression(nonce, action)) as string) as Record<string, unknown>,
    unmark: (nonce: string) => window.eval(demoUnmarkExpression(nonce)),
    state: () => JSON.parse(window.eval(demoPageStateExpression()) as string) as DemoPageState,
  };
}

const of = (events: RawDemoEvent[], type: RawDemoEvent["type"]) => events.filter((event) => event.type === type);
const lastInput = (events: RawDemoEvent[]) => of(events, "input").at(-1)!;

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysOf(item, found);
  else if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) { found.add(key); keysOf(inner, found); }
  return found;
}

describe("the recorder script in a page", () => {
  it("is absent until it is installed, and installing it again records each thing once", () => {
    const { window, drain, click } = page("<button>Save draft</button>", { install: false });
    expect(drain()).toMatchObject({ installed: false, events: [] });
    window.eval(DEMO_PAGE_SCRIPT);
    const first = drain();
    expect(first.installed).toBe(true);
    expect(first.url).toBe("https://portal.example/expenses/new");
    expect(first.events).toHaveLength(1);
    expect(first.events[0]).toMatchObject({ type: "open", url: "https://portal.example/expenses/new" });
    window.eval(DEMO_PAGE_SCRIPT);
    click("button");
    const second = drain();
    expect(of(second.events, "click")).toHaveLength(1);
    expect(of(second.events, "open")).toHaveLength(0);
    expect(drain().events).toEqual([]);
  });

  it("names what was clicked by its role and accessible name, never by where it is on screen", () => {
    const { drain, click } = page(`
      <button id="plain">Save draft</button>
      <a id="link" href="/help">Help</a>
      <input id="submit" type="submit" value="Continue">
      <button id="icon" aria-label="Close dialog">×</button>
      <div id="custom" role="button" tabindex="0">Add line</div>
      <button id="nested"><span id="inner">Deep</span> text</button>
      <p id="prose">Just some words.</p>`);
    drain();
    for (const selector of ["#plain", "#link", "#submit", "#icon", "#custom", "#inner", "#prose"]) click(selector);
    const { events } = drain();
    const clicks = of(events, "click");
    expect(clicks.map((event) => [event.target?.role, event.target?.name])).toEqual([
      ["button", "Save draft"], ["link", "Help"], ["button", "Continue"], ["button", "Close dialog"], ["button", "Add line"], ["button", "Deep text"], ["paragraph", ""],
    ]);
    expect(clicks.slice(0, 6).every((event) => event.target?.interactive === true)).toBe(true);
    expect(clicks[6]!.target?.interactive).not.toBe(true);
    const keys = keysOf(events);
    for (const banned of ["x", "y", "left", "top", "right", "bottom", "width", "height", "clientX", "clientY", "pageX", "pageY", "screenX", "screenY", "offsetX", "offsetY", "rect", "box", "selector", "xpath", "css"]) {
      expect(keys.has(banned), `an event carries "${banned}"`).toBe(false);
    }
    expect(JSON.stringify(events.map(({ at: _at, ...event }) => event))).not.toContain("412");
  });

  it("names a field by its label, however the page attached one, and by the words beside it when it has none", () => {
    const { drain, type } = page(`
      <label for="a">Merchant</label><input id="a">
      <label>Project code <input id="b"></label>
      <input id="c" aria-label="Cost centre">
      <span id="lbl">Trip purpose</span><input id="d" aria-labelledby="lbl">
      <table><tr><td>Amount (USD)</td><td><input id="e"></td></tr><tr><td><b>Report date</b></td><td><input id="f" placeholder="MM/DD/YYYY"></td></tr></table>
      <input id="g" placeholder="Search reports">
      <textarea id="h" title="Notes for the approver"></textarea>`);
    drain();
    const seen: Record<string, RawDemoEvent["target"]> = {};
    for (const id of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      type(`#${id}`, "v");
      seen[id] = lastInput(drain().events).target;
    }
    expect(seen.a).toMatchObject({ role: "textbox", name: "Merchant", editable: true });
    expect(seen.b).toMatchObject({ role: "textbox", name: "Project code" });
    expect(seen.c).toMatchObject({ role: "textbox", name: "Cost centre" });
    expect(seen.d).toMatchObject({ role: "textbox", name: "Trip purpose" });
    expect(seen.e).toMatchObject({ role: "textbox", name: "", label: "Amount (USD)" });
    expect(seen.f).toMatchObject({ role: "textbox", name: "", label: "Report date", placeholder: "MM/DD/YYYY" });
    expect(seen.g).toMatchObject({ role: "textbox", name: "", placeholder: "Search reports" });
    expect(seen.g?.label ?? "").toBe("");
    expect(seen.h).toMatchObject({ role: "textbox", name: "Notes for the approver" });
  });

  it("carries what a field holds after each key, a list's chosen words, a checkbox's state and a radio button's group", () => {
    const { window, $, drain, type, click } = page(`
      <label for="m">Merchant</label><input id="m">
      <label for="c">Category</label><select id="c"><option value="">-- Select --</option><option value="ML">Meals</option><option value="TR">Travel</option></select>
      <input type="checkbox" id="b"><label for="b">Billable to client</label>
      <fieldset><legend>Paid with</legend><label><input type="radio" name="p" id="p1" value="corp"> Company card</label><label><input type="radio" name="p" id="p2" value="pers"> Personal card</label></fieldset>
      <label for="r">Receipt</label><input type="file" id="r">`);
    drain();
    type("#m", "Lyft");
    const typed = of(drain().events, "input");
    expect(typed.map((event) => event.value)).toEqual(["L", "Ly", "Lyf", "Lyft"]);
    $("#c").value = "TR";
    $("#c").dispatchEvent(new window.Event("change", { bubbles: true }));
    click("#b");
    click("#p2");
    Object.defineProperty($("#r"), "files", { value: [new window.File(["x"], "receipt-07.pdf")], configurable: true });
    $("#r").dispatchEvent(new window.Event("change", { bubbles: true }));
    const changes = of(drain().events, "change");
    expect(changes.find((event) => event.target?.role === "combobox")).toMatchObject({ option: "Travel", target: { name: "Category" } });
    expect(changes.find((event) => event.target?.role === "checkbox")).toMatchObject({ checked: true, target: { name: "Billable to client" } });
    expect(changes.find((event) => event.target?.role === "radio")).toMatchObject({ checked: true, target: { name: "Personal card", within: "Paid with" } });
    expect(changes.find((event) => event.target?.role === "file")).toMatchObject({ files: ["receipt-07.pdf"], target: { name: "Receipt" } });
  });

  it("records the keys that do something, and never a letter", () => {
    const { window, $, drain } = page('<form><label for="q">Search</label><input id="q"></form>');
    drain();
    $("#q").focus();
    for (const key of ["h", "i", "Shift", "Tab", "Enter", "Escape", "ArrowDown", "7"]) $("#q").dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
    const keys = of(drain().events, "key");
    expect(keys.map((event) => event.key)).toEqual(["Tab", "Enter", "Escape"]);
    expect(keys[1]!.target).toMatchObject({ role: "textbox", name: "Search" });
  });

  it("never reads a field the page keeps private, even once the page shows what it holds", () => {
    const secret = "tr0ub4dor&3-horse";
    const { $, drain, type } = page(`
      <form>
        <label for="u">User ID</label><input id="u" autocomplete="username">
        <label for="p">Password</label><input id="p" type="password">
        <label for="o">Code from your phone</label><input id="o" autocomplete="one-time-code">
        <input id="cvv" name="cvv" placeholder="123">
        <label for="s">Security answer</label><input id="s">
        <label for="t">Passphrase</label><input id="t" type="password">
      </form>`);
    drain();
    type("#u", "ada.lovelace");
    for (const id of ["p", "o", "cvv", "s"]) type(`#${id}`, secret);
    type("#t", secret.slice(0, 5));
    $("#t").type = "text";
    type("#t", secret.slice(5));
    const { events } = drain();
    const text = JSON.stringify(events);
    expect(text).toContain("ada.lovelace");
    for (let length = 4; length <= secret.length; length++) expect(text).not.toContain(secret.slice(0, length));
    const privateInputs = events.filter((event) => (event.type === "input" || event.type === "change") && event.target?.name !== "User ID");
    expect(privateInputs.length).toBeGreaterThan(5);
    for (const event of privateInputs) {
      expect(event.target?.sensitive).toBe(true);
      expect("value" in event).toBe(false);
    }
    expect(events.filter((event) => event.target?.name === "User ID").every((event) => event.target?.sensitive !== true)).toBe(true);
  });

  it("says whether the page has loaded and whether it is asking for a password", () => {
    expect(page('<input type="password">').state()).toMatchObject({ url: "https://portal.example/expenses/new", ready: true, passwordField: true });
    expect(page('<input type="text"><input type="password" disabled>').state().passwordField).toBe(false);
  });
});

describe("finding an element again by its words", () => {
  const FORM = `
    <a href="/expenses/new" id="nav">New expense report</a><p><a href="/expenses/new" id="body">New expense report</a></p>
    <a href="/a" id="dup1">Details</a><a href="/b" id="dup2">Details</a>
    <table><tr><td>Amount (USD)</td><td><input id="amount"></td></tr><tr><td>Password</td><td><input id="pw" type="password"></td></tr></table>
    <label for="cat">Category</label><select id="cat"><option value="">-- Select --</option><option value="ML">Meals</option><option value="TR">Travel</option></select>
    <fieldset><legend>Paid with</legend><label><input type="radio" name="p" id="p1"> Company card</label><label><input type="radio" name="p" id="p2"> Personal card</label></fieldset>
    <fieldset><legend>Line 1</legend><button id="d1">Delete</button></fieldset>
    <fieldset><legend>Line 2</legend><button id="d2">Delete</button></fieldset>
    <input type="checkbox" id="bill" checked><label for="bill">Billable to client</label>
    <button id="off" disabled>Archive</button>`;

  it("answers a selector for the one element the words name, marked until it is let go", () => {
    const { window, find, unmark } = page(FORM);
    const found = find({ role: "textbox", name: "", label: "Amount (USD)" }, { kind: "fill" });
    expect(found).toMatchObject({ count: 1, tag: "input", sensitive: false });
    const element = window.document.querySelector(found.selector!) as unknown as Field;
    expect(element.id).toBe("amount");
    expect(element.getAttribute(DEMO_MARK)).toContain("n1");
    unmark("n1");
    expect(window.document.querySelectorAll(`[${DEMO_MARK}]`).length).toBe(0);
    expect(find({ role: "checkbox", name: "Billable to client" }, { kind: "check" })).toMatchObject({ count: 1, checked: true });
    expect(find({ role: "button", name: "Archive" }, { kind: "click" })).toMatchObject({ count: 1, disabled: true });
  });

  it("acts on nothing when the words fit no element or several, unless a group tells them apart", () => {
    const { window, find } = page(FORM);
    expect(find({ role: "button", name: "Submit report" }, { kind: "click" })).toMatchObject({ count: 0 });
    const both = find({ role: "button", name: "Delete" }, { kind: "click" });
    expect(both.count).toBe(2);
    expect(both.selector).toBeUndefined();
    expect(window.document.querySelectorAll(`[${DEMO_MARK}]`).length).toBe(0);
    const second = find({ role: "button", name: "Delete", within: "Line 2" }, { kind: "click" });
    expect(second.count).toBe(1);
    expect((window.document.querySelector(second.selector!) as unknown as Field).id).toBe("d2");
    expect(find({ role: "link", name: "Details" }, { kind: "click" }).count).toBe(2);
  });

  it("takes two links with the same name and the same address as one", () => {
    const { window, find } = page(FORM);
    const found = find({ role: "link", name: "New expense report" }, { kind: "click" });
    expect(found.count).toBe(1);
    expect((window.document.querySelector(found.selector!) as unknown as Field).id).toBe("nav");
  });

  it("finds an option by its words, in a list or in a group of radio buttons", () => {
    const { window, find } = page(FORM);
    expect(find({ role: "combobox", name: "Category" }, { kind: "select", value: "Travel" })).toMatchObject({ count: 1, option: true });
    expect(find({ role: "combobox", name: "Category" }, { kind: "select", value: "Parking" })).toMatchObject({ count: 1, option: false });
    const radio = find({ role: "radiogroup", name: "Paid with" }, { kind: "choose", value: "Personal card" });
    expect(radio).toMatchObject({ count: 1, option: true, checked: false });
    expect((window.document.querySelector(radio.selector!) as unknown as Field).id).toBe("p2");
    expect(find({ role: "radiogroup", name: "Paid with" }, { kind: "choose", value: "Cash" })).toMatchObject({ option: false });
  });

  it("says a private field is private, so nothing but a saved login is typed there", () => {
    const { find } = page(FORM);
    expect(find({ role: "textbox", name: "", label: "Password" }, { kind: "fill" })).toMatchObject({ count: 1, sensitive: true });
  });

  it("acts in the page where typing cannot: a list's option, a value set whole, and what a field holds now", () => {
    const { window, $, find, act } = page(FORM);
    const heard: string[] = [];
    for (const type of ["input", "change"]) window.document.addEventListener(type, (event) => heard.push(`${type}:${(event.target as unknown as Field).id}`));
    find({ role: "combobox", name: "Category" }, { kind: "select", value: "Travel" }, "n2");
    expect(act("n2", { do: "select", value: "Travel" })).toMatchObject({ ok: true });
    expect($("#cat").value).toBe("TR");
    find({ role: "textbox", name: "", label: "Amount (USD)" }, { kind: "fill" }, "n3");
    expect(act("n3", { do: "set", value: "42.15" })).toMatchObject({ ok: true });
    expect($("#amount").value).toBe("42.15");
    expect(heard).toEqual(["input:cat", "change:cat", "input:amount", "change:amount"]);
    expect(act("n3", { do: "read" })).toMatchObject({ ok: true, value: "42.15" });
    expect(act("n3", { do: "focus" })).toMatchObject({ ok: true });
    expect((window.document.activeElement as unknown as Field).id).toBe("amount");
    $("#pw").value = "tr0ub4dor&3";
    find({ role: "textbox", name: "", label: "Password" }, { kind: "fill" }, "n4");
    const read = act("n4", { do: "read" });
    expect(JSON.stringify(read)).not.toContain("tr0ub4dor");
    expect(act("n4", { do: "set", value: "x" })).toMatchObject({ ok: false });
    expect($("#pw").value).toBe("tr0ub4dor&3");
    expect(act("gone", { do: "read" })).toMatchObject({ ok: false });
  });
});
