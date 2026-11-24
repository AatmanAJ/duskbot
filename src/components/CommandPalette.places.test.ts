// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { loadLocale } from "@/lib/i18n";
import "@/testing/quiet-canceled-animations";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn(), openPage: vi.fn(), selectedId: "ada" as string | null }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: fixture.api,
    useStore: () => ({ state: { ...original.initialState, bots: [ada], groups: [], selectedId: fixture.selectedId }, dispatch: fixture.dispatch }),
  };
});
vi.mock("./bot-panel/panel-link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./bot-panel/panel-link")>()),
  openBotSettingsPage: fixture.openPage,
}));

import { CommandPalette, openCommandPalette } from "./CommandPalette";

const ada = { id: "ada", threadId: "ada-thread", name: "Ada", title: "", description: "", color: "blue", notifications: false, unread: false, busy: false, messages: [], section: "", modelSelection: { instanceId: "claude", model: "fake" } } as Bot;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fixture.api.mockResolvedValue({ hits: [] });
  fixture.selectedId = "ada";
});
afterEach(async () => {
  flushSync(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  await loadLocale("en");
});

function search(value: string): HTMLButtonElement[] {
  flushSync(() => root.render(createElement(CommandPalette)));
  flushSync(() => openCommandPalette());
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  flushSync(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

const named = (rows: HTMLButtonElement[], name: string) => rows.find((row) => row.textContent?.startsWith(name));

describe("Command palette and the words people bring from Grok Bot", () => {
  it.each([
    ["routines", "Routines", "routines"],
    ["automations", "Routines", "routines"],
    ["memories", "What it remembers", "memory"],
    ["memory", "What it remembers", "memory"],
    ["pages", "Library", "library"],
  ])("%s opens the open bot's %s", (query, name, page) => {
    const row = named(search(query), name);
    expect(row?.textContent).toContain("Ada");
    flushSync(() => row!.click());
    expect(fixture.openPage).toHaveBeenCalledWith(fixture.dispatch, "ada", page);
  });

  it("auto-review finds Settings: Permissions", () => {
    expect(named(search("auto-review"), "Settings: Permissions")).toBeTruthy();
  });

  it("offers no bot page when no bot is open", () => {
    fixture.selectedId = null;
    expect(named(search("routines"), "Routines")).toBeUndefined();
  });

  it("finds them in the active language and by the English words too", async () => {
    await loadLocale("es");
    expect(named(search("automatizaciones"), "Rutinas")).toBeTruthy();
    expect(named(search("automations"), "Rutinas")).toBeTruthy();
  });
});
