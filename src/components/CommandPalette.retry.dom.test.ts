// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn(), dispatch: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: fixture.api, useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch }) };
});

import { CommandPalette, openCommandPalette } from "./CommandPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

it("when search is unavailable, Enter in the search field tries again, as Try again does", async () => {
  fixture.api.mockRejectedValue(new Error("Server unreachable"));
  await act(async () => { root.render(createElement(CommandPalette)); });
  await act(async () => { openCommandPalette(); });
  const field = document.querySelector<HTMLInputElement>("input[aria-label]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "zzqx quarterly lunch");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await wait(250);
  expect(document.body.textContent).toContain("Try again");
  const before = fixture.api.mock.calls.length;
  await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await wait(250);
  expect(fixture.api.mock.calls.length).toBeGreaterThan(before);
});
