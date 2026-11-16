// @vitest-environment happy-dom
import { createElement, useCallback } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExternalStore, shallowEqual, useSyncSelector } from "./external-store";

type State = { count: number; label: string; items: number[] };
type Action = { type: "count" } | { type: "label"; label: string } | { type: "same" } | { type: "items"; items: number[] };

const reduce = (state: State, action: Action): State => {
  switch (action.type) {
    case "count": return { ...state, count: state.count + 1 };
    case "label": return { ...state, label: action.label };
    case "items": return { ...state, items: action.items };
    case "same": return state;
  }
};

let root: Root;
beforeEach(() => { root = createRoot(document.createElement("div")); });
afterEach(() => { flushSync(() => root.unmount()); });

describe("createExternalStore", () => {
  it("notifies only when the reducer returns a new state", () => {
    const store = createExternalStore(reduce, { count: 0, label: "a", items: [] });
    let calls = 0;
    const stop = store.subscribe(() => calls++);
    store.dispatch({ type: "same" });
    expect(calls).toBe(0);
    store.dispatch({ type: "count" });
    expect(calls).toBe(1);
    expect(store.getState().count).toBe(1);
    stop();
    store.dispatch({ type: "count" });
    expect(calls).toBe(1);
  });

  it("lets a listener unsubscribe another while notifying", () => {
    const store = createExternalStore(reduce, { count: 0, label: "a", items: [] });
    const seen: string[] = [];
    let stopSecond = () => {};
    store.subscribe(() => { seen.push("first"); stopSecond(); });
    stopSecond = store.subscribe(() => seen.push("second"));
    store.dispatch({ type: "count" });
    expect(seen).toEqual(["first"]);
  });
});

describe("useSyncSelector", () => {
  it("renders a reader again only when its selection changes", () => {
    const store = createExternalStore(reduce, { count: 0, label: "a", items: [] });
    let labelRenders = 0, countRenders = 0;
    const selectLabel = (state: State) => state.label;
    function Label() { useSyncSelector(store.subscribe, store.getState, selectLabel); labelRenders++; return null; }
    function Count() { useSyncSelector(store.subscribe, store.getState, (state: State) => state.count); countRenders++; return null; }
    flushSync(() => root.render(createElement("div", null, createElement(Label), createElement(Count))));
    expect([labelRenders, countRenders]).toEqual([1, 1]);
    flushSync(() => store.dispatch({ type: "count" }));
    expect([labelRenders, countRenders]).toEqual([1, 2]);
    flushSync(() => store.dispatch({ type: "label", label: "b" }));
    expect([labelRenders, countRenders]).toEqual([2, 2]);
  });

  it("keeps an equal selection's reference, so a fresh array does not render again", () => {
    const store = createExternalStore(reduce, { count: 0, label: "a", items: [1, 2] });
    const seen: number[][] = [];
    function Items() {
      const items = useSyncSelector(store.subscribe, store.getState, useCallback((state: State) => state.items.filter((item) => item > 0), []), shallowEqual);
      seen.push(items);
      return null;
    }
    flushSync(() => root.render(createElement(Items)));
    flushSync(() => store.dispatch({ type: "items", items: [1, 2] }));
    flushSync(() => store.dispatch({ type: "count" }));
    expect(seen).toHaveLength(1);
    flushSync(() => store.dispatch({ type: "items", items: [1, 2, 3] }));
    expect(seen.at(-1)).toEqual([1, 2, 3]);
  });

  it("reads the newest state with a selector that changed since the last render", () => {
    const store = createExternalStore(reduce, { count: 3, label: "a", items: [] });
    let read = 0;
    function Reader({ offset }: { offset: number }) { read = useSyncSelector(store.subscribe, store.getState, (state: State) => state.count + offset); return null; }
    flushSync(() => root.render(createElement(Reader, { offset: 1 })));
    expect(read).toBe(4);
    flushSync(() => root.render(createElement(Reader, { offset: 10 })));
    expect(read).toBe(13);
  });
});

describe("shallowEqual", () => {
  it("compares arrays and plain objects one level deep", () => {
    const shared = { a: 1 };
    expect(shallowEqual([1, shared], [1, shared])).toBe(true);
    expect(shallowEqual([1, { a: 1 }], [1, { a: 1 }])).toBe(false);
    expect(shallowEqual({ x: 1, y: shared }, { x: 1, y: shared })).toBe(true);
    expect(shallowEqual({ x: 1 }, { x: 1, y: undefined })).toBe(false);
    expect(shallowEqual([1], { 0: 1 })).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
  });
});
