// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { TEACH_LIMITS, teachMessage } from "../../shared/teach-task.ts";
import { TeachRecorders, taughtUrl, teachCommandOfV1, teachInputOf, teachInputOfV1, type Evaluate } from "./teach.ts";

const SESSION = "bot-session";
const ME = "local-owner";

function page(url: string, target: Record<string, unknown> | null, title = "Shop"): Evaluate {
  return async () => ({ url, title, target });
}

function recorder() {
  let now = 1_000;
  const recorders = new TeachRecorders(() => now);
  return { recorders, tick: (ms: number) => { now += ms; } };
}

describe("teach a task: recording", () => {
  it("records clicks, typing and keys with the page each happened on", async () => {
    const { recorders } = recorder();
    recorders.start(SESSION, ME);
    const search = page("https://shop.example/search?q=secret#top", { role: "searchbox", name: "Search products", type: "search", hints: [] });
    await recorders.note(SESSION, ME, teachInputOf({ type: "mouse", action: "down", button: "left", clickCount: 1, x: 10, y: 20 }), search);
    for (const key of "tea") await recorders.note(SESSION, ME, teachInputOf({ type: "key", action: "down", key, text: key, modifiers: 0 }), search);
    await recorders.note(SESSION, ME, teachInputOf({ type: "key", action: "down", key: "Backspace", modifiers: 0 }), search);
    await recorders.note(SESSION, ME, teachInputOf({ type: "key", action: "down", key: "Enter", text: "\r", modifiers: 0 }), search);
    const results = page("https://shop.example/results", { role: "link", name: "Green tea, 100 g", type: "", hints: [] }, "Results");
    await recorders.note(SESSION, ME, teachInputOf({ type: "mouse", action: "down", button: "left", clickCount: 1, x: 1, y: 1 }), results);

    expect(recorders.stop(SESSION, ME).steps).toEqual([
      { kind: "page", url: "https://shop.example/search", title: "Shop" },
      { kind: "click", target: { role: "searchbox", name: "Search products" } },
      { kind: "type", target: { role: "searchbox", name: "Search products" }, text: "te" },
      { kind: "key", key: "Enter" },
      { kind: "page", url: "https://shop.example/results", title: "Results" },
      { kind: "click", target: { role: "link", name: "Green tea, 100 g" } },
    ]);
  });

  it("never keeps what is typed into a password, code or card field", async () => {
    const { recorders } = recorder();
    recorders.start(SESSION, ME);
    const signIn = page("https://shop.example/login", { role: "textbox", name: "Password", type: "password", hints: [] });
    await recorders.note(SESSION, ME, teachInputOf({ type: "text", text: "hunter2" }), signIn);
    await recorders.note(SESSION, ME, teachInputOf({ type: "key", action: "down", key: "x", text: "x", modifiers: 0 }), signIn);
    const card = page("https://shop.example/pay", { role: "textbox", name: "Number", type: "text", hints: ["cc-number"] });
    await recorders.note(SESSION, ME, teachInputOf({ type: "key", action: "down", key: "Tab", modifiers: 0 }), card);
    await recorders.note(SESSION, ME, teachInputOf({ type: "text", text: "4242424242424242" }), card);
    const plain = page("https://shop.example/pay", { role: "textbox", name: "Note", type: "text", hints: [] });
    await recorders.note(SESSION, ME, { kind: "press", x: 1, y: 1 }, plain);
    await recorders.note(SESSION, ME, teachInputOf({ type: "text", text: "hello " }), plain);
    await recorders.note(SESSION, ME, teachInputOfV1({ type: "input_keyboard", eventType: "char", text: "typed-in-secret-box", secret: true }), plain);
    const status = recorders.status(SESSION, ME);
    expect(JSON.stringify(status)).not.toMatch(/hunter2|4242|typed-in-secret-box/);
    expect(status.steps.filter((step) => step.kind === "type")).toEqual([
      { kind: "type", target: { role: "textbox", name: "Password" }, text: "", hidden: true },
      { kind: "type", target: { role: "textbox", name: "Number" }, text: "", hidden: true },
      { kind: "type", target: { role: "textbox", name: "Note" }, text: "hello " },
      { kind: "type", target: { role: "textbox", name: "Note" }, text: "", hidden: true },
    ]);
    expect(teachMessage({ name: "Pay", purpose: "", steps: status.steps })).toContain("[hidden: it may be a password, code or card number]");
  });

  it("records only the person who started it, and nothing after Stop", async () => {
    const { recorders } = recorder();
    const evaluate = page("https://a.example/", { role: "button", name: "Go", type: "", hints: [] });
    const press = teachInputOf({ type: "mouse", action: "down", button: "left", x: 1, y: 1 });
    recorders.start(SESSION, ME);
    expect(() => recorders.start(SESSION, "someone-else")).toThrow(/Someone else/);
    await recorders.note(SESSION, "someone-else", press, evaluate);
    await recorders.note("another-browser", ME, press, evaluate);
    expect(recorders.status(SESSION, ME).steps).toEqual([]);
    expect(recorders.status(SESSION, "someone-else")).toEqual({ recording: false, steps: [] });
    recorders.stop(SESSION, ME);
    await recorders.note(SESSION, ME, press, evaluate);
    expect(recorders.status(SESSION, ME)).toMatchObject({ recording: false, stopped: "person", steps: [] });
    recorders.discard(SESSION, ME);
    expect(recorders.status(SESSION, ME)).toEqual({ recording: false, steps: [] });
  });

  it("stops by itself at ten minutes and at the step limit", async () => {
    const { recorders, tick } = recorder();
    recorders.start(SESSION, ME);
    tick(TEACH_LIMITS.ms);
    expect(recorders.status(SESSION, ME)).toMatchObject({ recording: false, stopped: "time" });

    recorders.start(SESSION, ME);
    const evaluate = page("https://a.example/", { role: "button", name: "Next", type: "", hints: [] });
    for (let at = 0; at < TEACH_LIMITS.steps + 5; at++) await recorders.note(SESSION, ME, { kind: "press", x: 1, y: 1 }, evaluate);
    const status = recorders.status(SESSION, ME);
    expect(status).toMatchObject({ recording: false, stopped: "steps" });
    expect(status.steps).toHaveLength(TEACH_LIMITS.steps);
  });

  it("still records the step when the page cannot be read", async () => {
    const { recorders } = recorder();
    recorders.start(SESSION, ME);
    await recorders.note(SESSION, ME, { kind: "press", x: 1, y: 1 }, async () => { throw new Error("detached"); });
    await recorders.note(SESSION, ME, { kind: "text", text: "maybe a code" }, async () => { throw new Error("detached"); });
    expect(recorders.status(SESSION, ME).steps).toEqual([{ kind: "click", target: null }, { kind: "type", target: null, text: "", hidden: true }]);
  });
});

describe("teach a task: inputs", () => {
  it("leaves shortcuts, releases, moves and double clicks out", () => {
    expect(teachInputOf({ type: "key", action: "down", key: "c", text: "c", modifiers: 4 })).toBeNull();
    expect(teachInputOf({ type: "key", action: "up", key: "a", modifiers: 0 })).toBeNull();
    expect(teachInputOf({ type: "mouse", action: "move", button: "none", x: 1, y: 1 })).toBeNull();
    expect(teachInputOf({ type: "mouse", action: "down", button: "left", clickCount: 2, x: 1, y: 1 })).toBeNull();
    expect(teachInputOf({ type: "key", action: "down", key: "ArrowDown", modifiers: 0 })).toBeNull();
    expect(teachInputOf({ type: "key", action: "down", key: "A", text: "A", modifiers: 8 })).toEqual({ kind: "text", text: "A" });
  });

  it("reads the v1 view's messages and toolbar commands the same way", () => {
    expect(teachInputOfV1({ type: "input_mouse", eventType: "mousePressed", button: "left", clickCount: 1, x: 4, y: 5 })).toEqual({ kind: "press", x: 4, y: 5 });
    expect(teachInputOfV1({ type: "input_keyboard", eventType: "char", text: "hello" })).toEqual({ kind: "text", text: "hello" });
    expect(teachInputOfV1({ type: "input_keyboard", eventType: "keyDown", key: "Tab", modifiers: 0 })).toEqual({ kind: "key", key: "Tab" });
    expect(teachCommandOfV1(["open", "https://a.example/x"])).toEqual({ kind: "open", url: "https://a.example/x" });
    expect(teachCommandOfV1(["back"])).toEqual({ kind: "key", key: "the browser's Back button" });
    expect(teachCommandOfV1(["tab", "t2"])).toBeNull();
  });

  it("keeps only the origin and path of an address", () => {
    expect(taughtUrl("https://user:pw@mail.example/reset/abc?token=xyz#a")).toBe("https://mail.example/reset/abc");
    expect(taughtUrl("javascript:alert(1)")).toBe("");
    expect(taughtUrl("not a url")).toBe("");
  });
});

// the server's tsconfig has no DOM types; happy-dom provides the document at run time
type Node = { focus(): void };
const document = (globalThis as unknown as { document: { body: { innerHTML: string }; querySelector(selector: string): Node | null; elementFromPoint: (x: number, y: number) => Node | null } }).document;

describe("teach a task: what the page tells the recorder", () => {
  async function inPage(html: string, focus?: string, at?: string): Promise<unknown> {
    document.body.innerHTML = html;
    if (focus) document.querySelector(focus)?.focus();
    const hit = at ? document.querySelector(at) : null;
    document.elementFromPoint = () => hit;
    const { recorders } = recorder();
    recorders.start(SESSION, ME);
    await recorders.note(SESSION, ME, at ? { kind: "press", x: 1, y: 1 } : { kind: "text", text: "a" }, async (source) => new Function(`return ${source}`)());
    return recorders.status(SESSION, ME).steps.find((step) => step.kind !== "page");
  }

  it("names a button by its text and a field by its label, never by its value", async () => {
    expect(await inPage(`<button id="b"><span>Export as CSV</span></button>`, undefined, "span")).toEqual({ kind: "click", target: { role: "button", name: "Export as CSV" } });
    const typed = await inPage(`<label for="e">Work email</label><input id="e" type="email" value="kept@private.example">`, "#e");
    expect(typed).toEqual({ kind: "type", target: { role: "textbox", name: "Work email" }, text: "a" });
    expect(JSON.stringify(typed)).not.toContain("private.example");
    expect(await inPage(`<input id="p" type="password" aria-label="Your secret">`, "#p")).toMatchObject({ hidden: true, text: "" });
  });
});
