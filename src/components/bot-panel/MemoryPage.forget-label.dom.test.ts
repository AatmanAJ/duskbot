// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, config: {} }, dispatch: vi.fn() }) };
});

const { MemoryPage } = await import("./pages");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const scout = (busy: boolean) => ({ id: "scout", threadId: "t1", name: "Scout", title: "", description: "", notifications: true, color: "green",
  unread: false, messages: [], busy, modelSelection: { instanceId: "x", model: "x" } }) as unknown as Bot;
const memory = "# Memory\n- Ada likes durian\n- Ada runs on Sundays\n";
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let failing = false;
let host: HTMLDivElement, root: Root;

beforeEach(() => {
  failing = false;
  vi.stubGlobal("fetch", vi.fn(async () => failing
    ? reply(500, { error: "disk busy" })
    : reply(200, { path: "MEMORY.md", text: memory, hash: "h1", exists: true, overview: {} })));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const render = async (busy: boolean) => {
  await act(async () => { root.render(createElement(MemoryPage, { bot: scout(busy), derived: {} as never })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

it("each Forget button names the note it forgets", async () => {
  await render(false);
  const forget = [...host.querySelectorAll<HTMLButtonElement>("[data-memory-note] button")].map((button) => button.getAttribute("aria-label"));
  expect(forget).toHaveLength(2);
  expect(new Set(forget).size).toBe(2);
  expect(forget[0]).toContain("Ada likes durian");
});
