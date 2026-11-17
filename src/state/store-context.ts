import { createContext, createElement, use, useMemo, useRef, useSyncExternalStore, type Dispatch, type ReactNode } from "react";
import { shallowEqual, useSyncSelector, type Equality, type Listener } from "./external-store";
import type { Action, AppState, BotAnnouncement } from "./store";
import { StoreRefContext } from "./store-ref-context";

export interface StoreActions {
  dispatch: Dispatch<Action>;
  flushBotPatches: (botId: string) => Promise<BotAnnouncement | null>;
  refreshInstances: (options?: { reportErrors?: boolean; cached?: boolean }) => Promise<void>;
  refreshModels: (instanceId: string) => Promise<void>;
}

/** What `useStore()` returns: the whole state with the store's actions. */
export interface StoreValue extends StoreActions {
  state: AppState;
}

/** The app store as StoreProvider provides it. This value never changes; readers subscribe to the part they draw. */
export interface StoreHandle extends StoreActions {
  getState(): AppState;
  subscribe(listener: Listener): () => void;
}

export const AppStoreContext = createContext<StoreHandle | null>(null);

/**
 * A fixed store value (a bot editor's, a test's): readers inside it see this value and re-render when it is replaced.
 * The app's own StoreProvider never provides it.
 */
export const StoreContext = createContext<StoreValue | null>(null);

const noSubscription = () => () => {};
const fixedSources = new WeakMap<StoreValue, StoreHandle>();

function fixedSource(value: StoreValue): StoreHandle {
  let source = fixedSources.get(value);
  if (!source) {
    source = { ...value, getState: () => value.state, subscribe: noSubscription };
    fixedSources.set(value, source);
  }
  return source;
}

function useSource(): StoreHandle | null {
  const fixed = use(StoreContext);
  const handle = use(AppStoreContext);
  return fixed ? fixedSource(fixed) : handle;
}

const missingState = (): AppState => {
  throw new Error("useStore outside provider");
};
const noState = (): AppState => undefined as unknown as AppState;

/** The store this component is drawn in. Throws outside any store. */
export function useStoreHandle(): StoreHandle {
  const source = useSource();
  if (!source) throw new Error("useStore outside provider");
  return source;
}

/** The part of the state `selector` picks; this component renders again only when that part changes (by `isEqual`). */
export function useStoreSelector<Selection>(selector: (state: AppState) => Selection, isEqual?: Equality<Selection>): Selection {
  const source = useSource();
  return useSyncSelector(source?.subscribe ?? noSubscription, source?.getState ?? missingState, selector, isEqual);
}

/** useStoreSelector compared field by field, for a selector that builds a fresh object or array each time. */
export function useStoreShallow<Selection>(selector: (state: AppState) => Selection): Selection {
  return useStoreSelector(selector, shallowEqual);
}

/** Like useStoreSelector, but `fallback` outside any store instead of throwing. */
export function useOptionalStoreSelector<Selection>(selector: (state: AppState) => Selection, fallback: Selection, isEqual?: Equality<Selection>): Selection {
  const source = useSource();
  const read = useMemo(() => source ? selector : () => fallback, [source, selector, fallback]);
  return useSyncSelector(source?.subscribe ?? noSubscription, source?.getState ?? noState, read, isEqual);
}

/** The store's dispatch. Never changes, and never makes this component render again. */
export function useDispatch(): Dispatch<Action> {
  return useStoreHandle().dispatch;
}

/** The store's dispatch and its other actions, without subscribing to any state. */
export function useStoreActions(): StoreActions {
  return useStoreHandle();
}

/** The store's actions, or null outside any store. */
export function useOptionalStoreActions(): StoreActions | null {
  return useSource();
}

/**
 * The whole state and the store's actions. This component renders again on every change to the state: prefer
 * useStoreSelector, and useDispatch where only actions are needed.
 */
export function useStore(): StoreValue {
  const fixed = use(StoreContext);
  const handle = use(AppStoreContext);
  const read = fixed ? () => fixed.state : handle?.getState ?? missingState;
  const state = useSyncExternalStore(fixed ? noSubscription : handle?.subscribe ?? noSubscription, read, read);
  const value = useMemo<StoreValue | null>(() => fixed ?? (handle && { state, dispatch: handle.dispatch, flushBotPatches: handle.flushBotPatches, refreshInstances: handle.refreshInstances, refreshModels: handle.refreshModels }), [fixed, handle, state]);
  if (!value) throw new Error("useStore outside provider");
  return value;
}

/** The whole state when drawn inside a store, null outside one. Renders again on every change, as useStore() does. */
export function useOptionalStore(): StoreValue | null {
  const fixed = use(StoreContext);
  const handle = use(AppStoreContext);
  const read = fixed ? () => fixed.state : handle?.getState ?? (() => null);
  const state = useSyncExternalStore(fixed ? noSubscription : handle?.subscribe ?? noSubscription, read, read);
  return useMemo<StoreValue | null>(() => fixed ?? (handle && state && { state, dispatch: handle.dispatch, flushBotPatches: handle.flushBotPatches, refreshInstances: handle.refreshInstances, refreshModels: handle.refreshModels }), [fixed, handle, state]);
}

/**
 * A store derived from the one around it: readers inside see `derive(state)` and follow the outer store's changes
 * through their own selectors, and `actions` stand in for the outer ones (a bot editor's draft takes its own patches).
 * The component that renders it does not subscribe to anything.
 */
export function ScopedStore({ derive, actions, children }: {
  derive: (state: AppState) => AppState;
  actions: Partial<StoreActions>;
  children: ReactNode;
}) {
  const parent = useStoreHandle();
  const latest = useRef({ derive, actions });
  latest.current = { derive, actions };
  const handle = useMemo<StoreHandle>(() => {
    let seen: { state: AppState; derive: (state: AppState) => AppState; derived: AppState } | null = null;
    const getState = () => {
      const state = parent.getState(), { derive } = latest.current;
      if (seen?.state !== state || seen.derive !== derive) seen = { state, derive, derived: derive(state) };
      return seen.derived;
    };
    return {
      getState,
      subscribe: parent.subscribe,
      dispatch: (action) => (latest.current.actions.dispatch ?? parent.dispatch)(action),
      flushBotPatches: (botId) => (latest.current.actions.flushBotPatches ?? parent.flushBotPatches)(botId),
      refreshInstances: (options) => (latest.current.actions.refreshInstances ?? parent.refreshInstances)(options),
      refreshModels: (instanceId) => (latest.current.actions.refreshModels ?? parent.refreshModels)(instanceId),
    };
  }, [parent]);
  const ref = useMemo(() => ({ dispatch: handle.dispatch, state: handle.getState }), [handle]);
  return createElement(StoreRefContext, { value: ref },
    createElement(StoreContext.Provider, { value: null },
      createElement(AppStoreContext, { value: handle }, children)));
}
