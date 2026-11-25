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
const bot = { id: "ada", threadId: "t1", name: "Ada", title: "", description: "", notifications: true, color: "green", unread: false, messages: [],
  modelSelection: { instanceId: "x", model: "x" } } as unknown as Bot;
const files: Record<string, string> = {};
let serverHasNotes = true;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const key of Object.keys(files)) delete files[key];
  serverHasNotes = true;
  Object.assign(files, {
    "MEMORY.md": "# Notes\n\n- ~~Kestrel Health renews on 15 January 2027.~~ · superseded 2026-11-23\n"
      + "- 2026-11-20 · from chat · ~~Northwind's contact is Tomasz Wilk.~~ · superseded 2026-11-23\n- Stand-up is Monday 09:30.\n",
    "memory/kestrel-health.md": "---\ntitle: kestrel health\naliases: [Kestrel]\n---\n\n- 2026-11-23 · from chat, corrected · Kestrel Health renews on 1 February 2027.\n",
    "memory/archive.md": "- 2026-01-02 · Old studio address on Park Row · moved 2026-11-01\n",
  });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://x");
    if (url.pathname.includes("/memory/mine")) return reply(403, { error: "not a team" });
    const doc = (path: string) => ({ path, text: files[path] ?? "", hash: `h${(files[path] ?? "").length}`, exists: path in files });
    if (url.pathname.endsWith("/memory")) {
      const topics = Object.keys(files).filter((file) => file.startsWith("memory/")).map((path) => ({ path, name: path.slice(7) }));
      const notes = ["MEMORY.md", ...topics.filter((topic) => topic.name !== "archive.md").map((topic) => topic.path)].map(doc);
      return reply(200, { topics, logs: [], ...(serverHasNotes && url.searchParams.has("notes") ? { notes } : {}) });
    }
    const body = init?.body ? JSON.parse(String(init.body)) as { path: string; text: string } : null;
    const path = body?.path ?? url.searchParams.get("path") ?? "MEMORY.md";
    if (init?.method === "PUT" && body) files[path] = body.text;
    return reply(200, { ...doc(path), overview: {} });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); });

it("shows what the bot knows now: a corrected note from its topic file, not the struck-through old one", async () => {
  await act(async () => root.render(createElement(MemoryPage, { bot, derived: {} as never })));
  await settle();
  const notes = [...host.querySelectorAll("[data-memory-note]")].map((note) => note.textContent);
  expect(notes.some((note) => note?.includes("renews on 1 February 2027"))).toBe(true);
  expect(host.querySelector("[data-memory-topic='memory/kestrel-health.md']")?.textContent).toBe("Kestrel health");
  expect(host.textContent).not.toContain("15 January");
  expect(host.textContent).not.toContain("Tomasz");
  expect(host.textContent).not.toContain("~~");
  expect(host.textContent, "the archive is history, not a note").not.toContain("Park Row");
  expect(notes).toHaveLength(2);
});

it("forgets a note in a topic file from that file, leaving the rest", async () => {
  await act(async () => root.render(createElement(MemoryPage, { bot, derived: {} as never })));
  await settle();
  const note = [...host.querySelectorAll("[data-memory-note]")].find((row) => row.textContent?.includes("1 February"))!;
  await act(async () => note.querySelector<HTMLButtonElement>("button")!.click());
  await settle();
  expect(files["memory/kestrel-health.md"]).not.toContain("1 February");
  expect(files["memory/kestrel-health.md"]).toContain("title: kestrel health");
  expect(files["MEMORY.md"]).toContain("Stand-up is Monday 09:30.");
});

it("reads a bot's 40 topic files in one request as it opens and as a turn starts and ends", async () => {
  for (let i = 1; i <= 40; i += 1) files[`memory/client-${i}.md`] = `---\ntitle: client ${i}\n---\n\n- Client ${i} pays on the 1st.\n`;
  const requests = vi.mocked(fetch);
  await act(async () => root.render(createElement(MemoryPage, { bot, derived: {} as never })));
  await settle();
  expect(host.querySelectorAll("[data-memory-topic]")).toHaveLength(41);
  const opened = requests.mock.calls.length;
  expect(opened).toBe(1);
  await act(async () => root.render(createElement(MemoryPage, { bot: { ...bot, busy: true }, derived: {} as never })));
  await settle();
  await act(async () => root.render(createElement(MemoryPage, { bot: { ...bot, busy: false }, derived: {} as never })));
  await settle();
  expect(requests.mock.calls.length - opened).toBe(2);
});

it("still lists topic notes from a server that sends the overview without them", async () => {
  serverHasNotes = false;
  await act(async () => root.render(createElement(MemoryPage, { bot, derived: {} as never })));
  await settle();
  expect([...host.querySelectorAll("[data-memory-note]")].some((note) => note.textContent?.includes("renews on 1 February 2027"))).toBe(true);
  expect(host.textContent).not.toContain("Park Row");
});
