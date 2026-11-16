import type { AppState, StoreValue } from "@/state/store";

type MockedUseStore = () => Partial<StoreValue> & { state?: Partial<AppState> };

/**
 * For a test that mocks the store module with its own `useStore`: the selector and dispatch hooks read that mock too,
 * so a component that moved from useStore() to useStoreSelector() sees the test's state.
 */
export function withStoreHooks<Module extends object>(mocked: Module): Module {
  const useStore = (mocked as { useStore?: MockedUseStore }).useStore;
  if (typeof useStore !== "function") return mocked;
  const state = () => useStore().state as AppState;
  const select = <T,>(selector: (state: AppState) => T) => selector(state());
  return {
    ...mocked,
    useStoreSelector: select,
    useStoreShallow: select,
    useOptionalStoreSelector: select,
    useDispatch: () => useStore().dispatch,
    useStoreActions: () => useStore(),
    useOptionalStoreActions: () => useStore(),
    useStoreHandle: () => ({ ...useStore(), getState: state, subscribe: () => () => {} }),
    useOptionalStore: () => useStore(),
  };
}
