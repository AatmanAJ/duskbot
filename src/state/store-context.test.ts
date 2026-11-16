// @vitest-environment happy-dom
import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotEditorStore, initialState, StoreProvider, useDispatch, useOptionalStoreSelector, useStore, useStoreSelector, type AppState } from "./store";

class FixtureEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  close() {}
}

let root: Root;
let store!: ReturnType<typeof useStore>;
const renders = { whole: 0, error: 0, notice: 0, dispatch: 0 };
const selectError = (state: AppState) => state.error;
const selectNotice = (state: AppState) => state.notice;

function Whole() { store = useStore(); renders.whole++; return null; }
function ErrorReader() { useStoreSelector(selectError); renders.error++; return null; }
function NoticeReader() { useStoreSelector(selectNotice); renders.notice++; return null; }
function DispatchOnly() { useDispatch(); renders.dispatch++; return null; }

beforeEach(() => {
  for (const key of Object.keys(renders) as Array<keyof typeof renders>) renders[key] = 0;
  vi.stubGlobal("EventSource", FixtureEventSource);
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ bots: [], groups: [], instances: [] })));
  root = createRoot(document.createElement("div"));
});
afterEach(() => {
  flushSync(() => root.unmount());
  vi.unstubAllGlobals();
});

const mount = (children: ReactNode) => flushSync(() => root.render(createElement(StoreProvider, null, createElement(Whole), children)));

describe("store selectors", () => {
  it("render a reader again only for the part it selects", () => {
    mount([createElement(ErrorReader, { key: "e" }), createElement(NoticeReader, { key: "n" }), createElement(DispatchOnly, { key: "d" })]);
    const before = { ...renders };
    flushSync(() => store.dispatch({ type: "error", message: "Something broke" }));
    expect(renders.whole).toBeGreaterThan(before.whole);
    expect(renders.error).toBe(before.error + 1);
    expect(renders.notice).toBe(before.notice);
    expect(renders.dispatch).toBe(before.dispatch);
  });

  it("see the state a dispatch made before the next render", () => {
    mount(null);
    store.dispatch({ type: "error", message: "first" });
    let seen: string | null = null;
    function Late() { seen = useStoreSelector(selectError); return null; }
    flushSync(() => root.render(createElement(StoreProvider, null, createElement(Whole), createElement(Late))));
    expect(seen).toBe("first");
  });

  it("follow a fixed store value inside BotEditorStore", () => {
    let seen: string | null = null;
    function Reader() { seen = useStoreSelector(selectError); return null; }
    const value = (error: string) => ({ ...store, state: { ...initialState, error }, dispatch: vi.fn() });
    mount(null);
    flushSync(() => root.render(createElement(StoreProvider, null, createElement(BotEditorStore, { value: value("scoped"), children: createElement(Reader) }))));
    expect(seen).toBe("scoped");
    flushSync(() => root.render(createElement(StoreProvider, null, createElement(BotEditorStore, { value: value("replaced"), children: createElement(Reader) }))));
    expect(seen).toBe("replaced");
  });

  it("throw outside a store, unless the reader asked for a fallback", () => {
    function Strict() { useStoreSelector(selectError); return null; }
    function Lenient() { return createElement("span", null, useOptionalStoreSelector(selectError, "none")); }
    const host = document.createElement("div");
    const errors: unknown[] = [];
    const lone = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
    flushSync(() => lone.render(createElement(Lenient)));
    expect(host.textContent).toBe("none");
    flushSync(() => lone.render(createElement(Strict)));
    expect(String(errors[0])).toContain("useStore outside provider");
    flushSync(() => lone.unmount());
  });
});
