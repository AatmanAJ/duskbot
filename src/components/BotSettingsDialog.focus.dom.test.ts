// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { initialState, type Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => (await import("@/testing/store-mock")).withStoreHooks(await (async (original) => ({ ...await original<typeof import("@/state/store")>(), useStore: () => ({ state: initialState, dispatch: () => {} }) }))(importOriginal)));
vi.mock("./bot-settings/useBotSettingsDerived", () => ({ useBotSettingsDerived: () => ({}) }));
vi.mock("./bot-panel/PanelShell", () => ({ BotPanel: () => createElement("button", { type: "button", "data-panel-close": "" }, "close") }));

import { BotSettingsDialog } from "./BotSettingsDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = (id: string) => ({ id, name: id }) as Bot;

it("swapping the panel for the clicked bot's never pulls focus back to a row, and a close still returns it", async () => {
  document.body.innerHTML = "";
  const rows = Object.fromEntries(["top", "bottom", "pill"].map((name) => {
    const row = document.body.appendChild(document.createElement("button"));
    row.dataset.name = name;
    return [name, row];
  }));
  const focused: string[] = [];
  for (const row of Object.values(rows)) row.addEventListener("focus", () => focused.push(row.dataset.name!));
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const show = async (id: string | null) => {
    await act(async () => { root.render(createElement(Fragment, null, id ? createElement(BotSettingsDialog, { key: `settings:${id}`, bot: bot(id) }) : null)); });
    await act(() => Promise.resolve());
  };

  // the panel opens while the top row holds focus (as it does once a reload brings it back open and that row is
  // clicked); a click on a row far down then swaps it for that bot's
  rows.top!.focus();
  await show("top");
  rows.bottom!.focus();
  focused.length = 0;
  await show("bottom");
  expect(focused, "the swap leaves the top row alone, so the sidebar does not scroll to it").toEqual([]);
  expect(document.activeElement, "nor pulls focus into the panel: the chat box takes it as the chat opens").toBe(rows.bottom);

  // closing from inside the panel hands focus to what opened it
  await show(null);
  rows.pill!.focus();
  await show("b");
  document.querySelector<HTMLElement>("[data-panel-close]")!.focus();
  await show(null);
  expect(document.activeElement).toBe(rows.pill);

  // a close by a click elsewhere keeps that focus
  await show("c");
  rows.bottom!.focus();
  await show(null);
  expect(document.activeElement).toBe(rows.bottom);
  act(() => root.unmount());
});
