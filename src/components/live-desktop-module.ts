import { useEffect, useState } from "react";
import type { LiveDesktop as LiveDesktopComponent } from "./LiveDesktop";

type LiveDesktopType = typeof LiveDesktopComponent;
export type LiveDesktopModule = { kind: "loading" } | { kind: "ready"; LiveDesktop: LiveDesktopType } | { kind: "failed" };

// Not React.lazy: a failed import rethrows on every render and takes the whole window down with it. Chromium keeps a
// failed import() in its module map, so a failure stands until the window reloads.
let loaded: LiveDesktopType | undefined;
let failed = false;
let loading: Promise<LiveDesktopType> | undefined;

export function loadLiveDesktop(load: () => Promise<{ LiveDesktop: LiveDesktopType }> = () => import("./LiveDesktop")): Promise<LiveDesktopType> {
  return (loading ??= load().then(
    (module) => (loaded = module.LiveDesktop),
    (error: unknown) => {
      failed = true;
      console.warn("[live-desktop] the screen viewer could not be loaded", error);
      throw error;
    },
  ));
}

/** Fetches the viewer's code ahead of the screen that needs it; a failure is the hook's to show, never unhandled. */
export function preloadLiveDesktop(): void {
  void loadLiveDesktop().catch(() => {});
}

function current(): LiveDesktopModule {
  return loaded ? { kind: "ready", LiveDesktop: loaded } : failed ? { kind: "failed" } : { kind: "loading" };
}

export function useLiveDesktop(wanted: boolean): LiveDesktopModule {
  const [module, setModule] = useState(current);
  useEffect(() => {
    if (!wanted || module.kind !== "loading") return;
    let live = true;
    void loadLiveDesktop().then(() => { if (live) setModule(current()); }, () => { if (live) setModule(current()); });
    return () => { live = false; };
  }, [wanted, module.kind]);
  return module;
}

export function resetLiveDesktopForTests(): void {
  loaded = undefined;
  failed = false;
  loading = undefined;
}
