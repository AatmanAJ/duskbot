// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: () => {} }) };
});
vi.mock("@/lib/bot-defaults-prefetch", () => ({ prefetchBotDefaults: () => {} }));

import { setLocale } from "@/lib/i18n";
import { CreateBotDialog, openCreateBot } from "./CreateBotDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; setLocale("en"); });

const ENGLISH = ["Create new bot", "Name your bot", "Cancel", "Create", "character color"];

for (const tag of ["de", "es"]) {
  it(`the New bot dialog speaks ${tag}, not English`, async () => {
    setLocale(tag);
    await act(async () => { root.render(createElement(CreateBotDialog)); });
    await act(async () => { openCreateBot(); });
    const dialog = document.querySelector<HTMLElement>("[data-create-bot-dialog]")!;
    const words = [
      dialog.querySelector("h2")?.textContent ?? "",
      dialog.querySelector("input")?.getAttribute("placeholder") ?? "",
      ...[...dialog.querySelectorAll("button")].flatMap((button) => [button.textContent ?? "", button.getAttribute("aria-label") ?? ""]),
    ].map((word) => word.trim());
    for (const english of ENGLISH) {
      expect(words.filter((word) => word === english || word.endsWith(` ${english}`))).toEqual([]);
    }
  });
}
