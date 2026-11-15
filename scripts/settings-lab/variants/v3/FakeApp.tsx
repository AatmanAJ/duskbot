// the app's own store and reducer, seeded from the fake server instead of a harness: real settings components read
// and dispatch exactly as they do in the app. live sockets, bot sync and transcripts are left out.
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { StoreContext, initialState, reducer, type AppState } from "@/state/store";
import { StoreRefContext } from "@/state/store-ref-context";
import { setLocale } from "@/lib/i18n";
import { claimFetch, server } from "./fake-server";
import { claimDesktop } from "./fake-desktop";

const claim = () => {
  const fetchBack = claimFetch();
  const desktopBack = claimDesktop();
  return () => { fetchBack(); desktopBack(); };
};

setLocale("en");

const seed = (): AppState => ({
  ...initialState,
  config: server.config,
  instances: server.instances,
  connected: true,
  hydrated: true,
});

export function FakeApp({ children }: { children: ReactNode }) {
  // claimed while rendering, before any child's effect can ask for something; given back when v3 goes away
  useState(claim);
  useEffect(() => claim(), []);
  const [state, dispatch] = useReducer(reducer, undefined, seed);
  const stateRef = useRef(state);
  stateRef.current = state;
  const value = useMemo(() => ({
    state,
    dispatch,
    flushBotPatches: async () => null,
    refreshInstances: async () => { dispatch({ type: "instances", instances: server.instances }); },
    refreshModels: async () => {},
  }), [state]);
  const ref = useMemo(() => ({ dispatch, state: () => stateRef.current }), []);
  return <StoreRefContext value={ref}><StoreContext.Provider value={value}>{children}</StoreContext.Provider></StoreRefContext>;
}
