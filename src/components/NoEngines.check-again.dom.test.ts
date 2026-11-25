// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { initialState, StoreContext, type AppState } from "@/state/store";
import { NoEngines } from "./NoEngines";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DesktopWindow = { duskDesktop?: unknown };
let root: Root;
beforeEach(() => {
  (window as DesktopWindow).duskDesktop = { remoteClient: { active: true } };
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  delete (window as DesktopWindow).duskDesktop;
});

/** The store's refreshInstances, as it behaves when the harness can't be reached: it throws only when asked to report. */
const unreachable = vi.fn(async (options?: { reportErrors?: boolean }) => {
  if (options?.reportErrors) throw new Error("The dusk bot server isn't answering.");
});

it("Check again on the host-needs-an-AI screen says when the check itself failed, instead of just stopping", async () => {
  await act(async () => {
    root.render(createElement(StoreContext.Provider,
      { value: { state: { ...initialState, instances: [] } as AppState, dispatch: vi.fn(), flushBotPatches: vi.fn(), refreshInstances: unreachable, refreshModels: vi.fn() } as never },
      createElement(NoEngines)));
  });
  const again = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Check again"))!;
  expect(again).toBeTruthy();
  await act(async () => { again.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(unreachable).toHaveBeenCalledWith({ reportErrors: true });
  expect(document.querySelector("[role=alert]")?.textContent).toBeTruthy();
});
