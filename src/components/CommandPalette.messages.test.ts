// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { SearchHit } from "@/lib/search-hit";
import "@/testing/quiet-canceled-animations";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: fixture.api, useStore: () => ({ state: { ...original.initialState, bots: [ada], groups: [] }, dispatch: fixture.dispatch }) };
});

import { CommandPalette, openCommandPalette } from "./CommandPalette";

const ada = { id: "ada", threadId: "t-new", name: "Ada", title: "", description: "", color: "blue", notifications: false, unread: false, busy: false, messages: [],
  section: "", modelSelection: { instanceId: "claude", model: "fake" } } as unknown as Bot;
const hit = (threadId: string, task: string, snippet = "The Kestrel invoice code is KX-4471."): SearchHit => ({ botId: "ada", name: "Ada", threadId, task, messageId: `m-${threadId}`, role: "user", kind: "text",
  at: 1, snippet, matchStart: snippet.indexOf("KX-4471"), matchLength: 7, onActivePath: true });

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fixture.api.mockImplementation(async (path: string) => (path.startsWith("/api/search")
    ? { hits: [hit("t-invoices", "Invoices for November"), hit("t-kestrel", "Kestrel renewal prep"),
      hit("t-code", "Kestrel code is KX-4471, keep it…", "Kestrel code is KX-4471, keep it handy for the proposal.")] } : {}));
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

it("names the conversation each message result is in, so two of a bot's chats with the same words can be told apart", async () => {
  flushSync(() => root.render(createElement(CommandPalette)));
  flushSync(() => openCommandPalette());
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  flushSync(() => {
    setter.call(input, "KX-4471");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await vi.waitFor(() => expect(document.querySelectorAll("[data-palette-row^='msg:']")).toHaveLength(3));
  const rows = [...document.querySelectorAll("[data-palette-row^='msg:']")].map((row) => row.textContent);
  expect(rows[0]).toContain("Ada · Invoices for November");
  expect(rows[1]).toContain("Ada · Kestrel renewal prep");
  expect(rows[2], "the message that titled its conversation is not named twice").not.toContain("·");
});
