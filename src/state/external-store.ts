import { useMemo, useRef, useSyncExternalStore } from "react";

export type Listener = () => void;

/** A state container React reads with useSyncExternalStore: readers re-render only when what they select changes. */
export interface ExternalStore<State, Action> {
  getState(): State;
  /** Returns the unsubscribe. Listeners run after every dispatch that changed the state. */
  subscribe(listener: Listener): () => void;
  /** Applies the action and tells readers at once, with anything a batched dispatch left waiting. */
  dispatch(action: Action): void;
  /**
   * Applies the action at once but tells readers once, on the next task, for every batched action until then: frames
   * that arrive together render together, as React's own default-priority updates did.
   */
  dispatchBatched(action: Action): void;
}

/** The next task, not a microtask: frames from separate network events still fall in one batch. */
function nextTask(run: () => void): void {
  if (typeof MessageChannel === "function") {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      run();
    };
    channel.port2.postMessage(null);
  } else {
    setTimeout(run, 0);
  }
}

export function createExternalStore<State, Action>(
  reducer: (state: State, action: Action) => State,
  initial: State,
  schedule: (run: () => void) => void = nextTask,
): ExternalStore<State, Action> {
  let state = initial;
  let unheard = false;
  let scheduled = false;
  const listeners = new Set<Listener>();
  const notify = () => {
    unheard = false;
    for (const listener of listeners) listener();
  };
  const apply = (action: Action) => {
    const next = reducer(state, action);
    if (Object.is(next, state)) return false;
    state = next;
    return true;
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispatch(action) {
      if (apply(action) || unheard) notify();
    },
    dispatchBatched(action) {
      if (!apply(action)) return;
      unheard = true;
      if (scheduled) return;
      scheduled = true;
      schedule(() => {
        scheduled = false;
        if (unheard) notify();
      });
    },
  };
}

export type Equality<T> = (a: T, b: T) => boolean;

/**
 * useSyncExternalStore with a selector: the selection is recomputed only for a new state or a new selector, and an
 * equal selection keeps the previous reference, so the reader does not render again.
 */
export function useSyncSelector<State, Selection>(
  subscribe: (listener: Listener) => () => void,
  getState: () => State,
  selector: (state: State) => Selection,
  isEqual: Equality<Selection> = Object.is,
): Selection {
  const last = useRef<{ selection: Selection } | null>(null);
  const getSelection = useMemo(() => {
    let memoState: State;
    let memoSelection: Selection;
    let memoized = false;
    return () => {
      const state = getState();
      if (memoized && Object.is(state, memoState)) return memoSelection;
      const next = selector(state);
      memoState = state;
      memoized = true;
      const previous = last.current;
      memoSelection = previous && isEqual(previous.selection, next) ? previous.selection : next;
      return memoSelection;
    };
  }, [getState, selector, isEqual]);
  const selection = useSyncExternalStore(subscribe, getSelection, getSelection);
  last.current = { selection };
  return selection;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) if (!Object.is(a[index], b[index])) return false;
    return true;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || !Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}
