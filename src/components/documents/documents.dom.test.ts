// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatDocumentCard, DocumentWithContent } from "../../../shared/documents";

const dispatch = vi.fn();
const openPage = vi.fn();
const calls: Array<{ path: string; init?: RequestInit }> = [];
let answer: (path: string, init?: RequestInit) => unknown = () => ({});

class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch }), visibleMessages: () => [] }));
vi.mock("@/state/api", () => ({
  ApiError,
  api: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return answer(path, init); },
}));
vi.mock("../bot-panel/panel-link", () => ({ openBotSettingsPage: (...args: unknown[]) => openPage(...args) }));
vi.mock("@/lib/panel-wide", () => ({ panelWide: () => false, setPanelWide: vi.fn() }));

const { DocumentCard } = await import("./DocumentCard");
const { DocumentPage } = await import("./DocumentPage");
const { SheetGrid } = await import("./SheetGrid");
const { setOpenDocument } = await import("./document-data");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => { root = createRoot(host); root.render(element); });
  return host;
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

beforeEach(() => { calls.length = 0; dispatch.mockReset(); openPage.mockReset(); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; });

const sheetCard: ChatDocumentCard = {
  botId: "b1", id: "d_0123456789ab", title: "Leads", kind: "sheet", bytes: 40, rows: 12, columns: 3,
  grid: [["Name", "Email", "Stage"], ["Ada", "ada@x.io", "Call"]], updatedAt: 1, version: 1, change: "created",
};

describe("the chat's file card", () => {
  it("names the file, peeks at its rows and opens it in the bot's panel", () => {
    const host = mount(createElement(DocumentCard, { message: { id: "m1", role: "bot", kind: "text", text: "", at: 1, document: sheetCard } as never }));
    const card = host.querySelector<HTMLButtonElement>("button[data-document-card]")!;
    expect(card.getAttribute("aria-label")).toBe("Open Leads");
    expect(card.textContent).toContain("Sheet · 12 rows · 3 columns");
    expect(host.querySelector("[data-document-peek=sheet]")!.textContent).toContain("ada@x.io");
    act(() => card.click());
    expect(openPage).toHaveBeenCalledWith(dispatch, "b1", "document");
  });

  it("peeks at a Markdown file's first lines and says when it was updated", () => {
    const card: ChatDocumentCard = { ...sheetCard, kind: "markdown", grid: undefined, rows: undefined, columns: undefined, bytes: 2048, lines: ["Launch plan", "Ship on Monday"], change: "updated" };
    const host = mount(createElement(DocumentCard, { message: { id: "m1", role: "bot", kind: "text", text: "", at: 1, document: card } as never }));
    expect(host.textContent).toContain("Updated · Document · 2.0 KB");
    expect([...host.querySelectorAll("[data-document-peek=markdown] span")].map((line) => line.textContent)).toEqual(["Launch plan", "Ship on Monday"]);
  });
});

describe("the sheet grid", () => {
  it("edits a cell, adds a row and a column, and moves down on Enter", () => {
    const onChange = vi.fn();
    const grid = [["Name", "Stage"], ["Ada", "Call"], ["Lin", "Won"]];
    const host = mount(createElement(SheetGrid, { grid, editing: true, title: "Leads", onChange }));
    const cell = host.querySelector<HTMLInputElement>('[data-cell="1:1"]')!;
    expect(cell.getAttribute("aria-label")).toBe("Cell B1");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(cell, "Lost");
      cell.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith([["Name", "Stage"], ["Ada", "Lost"], ["Lin", "Won"]]);
    act(() => host.querySelector<HTMLButtonElement>("[data-sheet-add=row]")!.click());
    expect(onChange).toHaveBeenLastCalledWith([...grid, ["", ""]]);
    act(() => host.querySelector<HTMLButtonElement>("[data-sheet-add=column]")!.click());
    expect(onChange).toHaveBeenLastCalledWith([["Name", "Stage", "C"], ["Ada", "Call", ""], ["Lin", "Won", ""]]);
    cell.focus();
    act(() => { cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(document.activeElement).toBe(host.querySelector('[data-cell="2:1"]'));
  });

  it("reads as plain cells when not editing", () => {
    const host = mount(createElement(SheetGrid, { grid: [["Name"], ["Ada"]], editing: false, title: "Leads" }));
    expect(host.querySelector("input")).toBeNull();
    expect(host.querySelector("table")!.getAttribute("aria-label")).toBe("Leads");
  });
});

describe("the file page", () => {
  const doc: DocumentWithContent = {
    id: "d_0123456789ab", botId: "b1", title: "Leads", kind: "sheet", bytes: 20, rows: 1, columns: 2, createdAt: 1, updatedAt: 1,
    version: 3, by: "bot", content: "Name,Stage\nAda,Call\n", versions: [{ version: 2, at: 1, by: "bot", bytes: 10 }],
  };
  const bot = { id: "b1", name: "Tally" } as never;

  it("saves an edited sheet as CSV against the version it opened", async () => {
    answer = (_path, init) => (init?.method === "PATCH" ? { ...doc, version: 4, content: JSON.parse(String(init.body)).content } : doc);
    setOpenDocument({ botId: "b1", id: doc.id });
    const host = mount(createElement(DocumentPage, { bot }));
    await flush();
    expect(host.querySelector("h2")!.textContent).toBe("Leads");
    act(() => host.querySelector<HTMLButtonElement>("[data-document-edit]")!.click());
    const save = host.querySelector<HTMLButtonElement>("[data-document-save]")!;
    expect(save.disabled).toBe(true);
    const cell = host.querySelector<HTMLInputElement>('[data-cell="1:1"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(cell, "Won");
      cell.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>("[data-document-save]")!.click());
    await flush();
    const patch = calls.find((call) => call.init?.method === "PATCH")!;
    expect(patch.path).toBe(`/api/bots/b1/documents/${doc.id}`);
    expect(JSON.parse(String(patch.init!.body))).toEqual({ content: "Name,Stage\nAda,Won", expectedVersion: 3 });
    expect(host.querySelector("[data-document-save]")).toBeNull();
  });

  it("says the bot changed the file meanwhile instead of overwriting it", async () => {
    answer = (_path, init) => { if (init?.method === "PATCH") throw new ApiError("changed", 409); return doc; };
    setOpenDocument({ botId: "b1", id: doc.id });
    const host = mount(createElement(DocumentPage, { bot }));
    await flush();
    act(() => host.querySelector<HTMLButtonElement>("[data-document-edit]")!.click());
    const cell = host.querySelector<HTMLInputElement>('[data-cell="1:0"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(cell, "Bea");
      cell.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>("[data-document-save]")!.click());
    await flush();
    expect(host.querySelector("[role=alert]")!.textContent).toContain("Tally changed this file while you were editing");
    expect(host.querySelector<HTMLInputElement>('[data-cell="1:0"]')!.value).toBe("Bea");
  });

  it("says when the file is gone", async () => {
    answer = () => { throw new ApiError("gone", 404); };
    setOpenDocument({ botId: "b1", id: doc.id });
    const host = mount(createElement(DocumentPage, { bot }));
    await flush();
    expect(host.querySelector("[role=alert]")!.textContent).toBe("This file was deleted.");
  });
});
