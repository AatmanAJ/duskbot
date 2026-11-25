// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  signals: { enabled: true, notes: false as boolean | null, askUsage: false, askNotes: false },
  shared: null as null | { notes: unknown[]; counts: unknown[]; removing: boolean },
  calls: [] as Array<{ path: string; method: string; body?: unknown }>,
  failDelete: false,
  opened: [] as string[],
}));
vi.mock("@/state/api", () => ({
  api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    f.calls.push({ path, method, ...(body ? { body } : {}) });
    if (path === "/api/dashboard/usage-shared") {
      if (method === "DELETE") {
        if (f.failDelete) throw new Error("offline");
        return { ok: true, removing: true };
      }
      if (!f.shared) throw new Error("offline");
      return f.shared;
    }
    if (method === "PUT") f.signals = { ...f.signals, ...body, ...(body.enabled ? { askUsage: false } : {}) };
    return f.signals;
  }),
}));
vi.mock("./ListRows", () => ({ useSubPage: () => ({ at: undefined, open: (id: string) => f.opened.push(id), back: () => {} }) }));

const { DataSharingRows, SHARED_DATA_PAGE } = await import("./DataSharingRows");
const { SharedDataPage } = await import("./SharedDataPage");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const host = document.createElement("div");
document.body.append(host);
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
async function render(component: () => ReturnType<typeof createElement> | null) {
  root = createRoot(host);
  await act(async () => { root!.render(createElement(component)); });
  await settle();
}
const $ = <T extends Element = HTMLButtonElement>(selector: string) => host.querySelector<T>(selector);
const click = async (selector: string) => {
  await act(async () => { $(selector)!.click(); });
  await settle();
};
const puts = () => f.calls.filter((call) => call.method === "PUT").map((call) => call.body);

beforeEach(() => {
  f.signals = { enabled: true, notes: false, askUsage: false, askNotes: false };
  f.shared = null;
  f.calls = [];
  f.failDelete = false;
  f.opened = [];
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("Settings > Privacy", () => {
  it("has the usage switch, a session notes switch of its own and the way to what's been shared", async () => {
    await render(DataSharingRows);
    expect($("[data-help-improve]")!.getAttribute("aria-checked")).toBe("true");
    expect($("[data-session-notes]")!.getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain("Turning this off also deletes summaries already shared.");
    expect($("[data-privacy-link]")!.getAttribute("role")).toBe("link");
    await click("[data-session-notes]");
    expect(puts()).toEqual([{ notes: true }]);
    expect($("[data-session-notes]")!.getAttribute("aria-checked")).toBe("true");
    await click(`[data-panel-page="${SHARED_DATA_PAGE}"]`);
    expect(f.opened).toEqual([SHARED_DATA_PAGE]);
  });

  it("session notes are off and can't be turned on while usage sharing is off", async () => {
    f.signals = { enabled: false, notes: true, askUsage: false, askNotes: false };
    await render(DataSharingRows);
    expect($("[data-session-notes]")!.getAttribute("aria-checked")).toBe("false");
    expect($("[data-session-notes]")!.disabled).toBe(true);
    expect(host.textContent).not.toContain("Turning this off also deletes summaries already shared.");
  });

  it("where a yes is needed, usage sharing reads off until turned on", async () => {
    f.signals = { enabled: false, notes: null, askUsage: true, askNotes: false };
    await render(DataSharingRows);
    expect($("[data-help-improve]")!.getAttribute("aria-checked")).toBe("false");
    expect(host.textContent).toContain("Off until you turn it on.");
    await click("[data-help-improve]");
    expect(puts()).toEqual([{ enabled: true }]);
    expect(host.textContent).not.toContain("Off until you turn it on.");
  });
});

describe("what's been shared", () => {
  const now = Date.now();
  it("lists the notes by kind and the kinds of counts", async () => {
    f.shared = {
      notes: [
        { id: "a", kind: "bad", at: now - 60_000, text: "Slow. A spreadsheet was too big to read." },
        { id: "b", kind: "weekly", at: now - 86_400_000 * 2, text: null },
      ],
      counts: [{ kind: "events", count: 12, last: now, names: ["engine_sign_in", "some_new_event"] }],
      removing: false,
    };
    await render(SharedDataPage);
    expect(host.textContent).toContain("After a hard chat");
    expect(host.textContent).toContain("Slow. A spreadsheet was too big to read.");
    expect(host.textContent).toContain("Only counts were sent for this one.");
    expect(host.textContent).toContain("App events");
    expect(host.textContent).toContain("AI sign-in");
    expect(host.textContent).toContain("AI sign-in, Some new event");
    expect(host.textContent).not.toContain("engine_sign_in");
  });

  it("Delete all asks first, then deletes and says it is being removed", async () => {
    f.shared = { notes: [{ id: "a", kind: "big", at: now, text: "Went well." }], counts: [], removing: false };
    await render(SharedDataPage);
    await click("[data-shared-delete]");
    expect(f.calls.some((call) => call.method === "DELETE")).toBe(false);
    await click("[data-shared-delete-confirm]");
    expect(f.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect($("[data-shared-removing]")!.textContent).toBe("Removing from dusk bot's servers…");
    expect($("[data-shared-empty]")).not.toBeNull();
  });

  it("a failed delete gives a title, a line and a way to try again", async () => {
    f.shared = { notes: [{ id: "a", kind: "big", at: now, text: "Went well." }], counts: [], removing: false };
    f.failDelete = true;
    await render(SharedDataPage);
    await click("[data-shared-delete]");
    await click("[data-shared-delete-confirm]");
    const problem = $<HTMLElement>("[data-shared-problem]")!;
    expect(problem.textContent).toContain("Couldn't delete that");
    f.failDelete = false;
    await act(async () => { problem.querySelector("button")!.click(); });
    await settle();
    expect($("[data-shared-empty]")).not.toBeNull();
  });

  it("shows an empty state, and a retry when it can't load", async () => {
    await render(SharedDataPage);
    expect($<HTMLElement>("[data-shared-problem]")!.textContent).toContain("Couldn't load what's been shared");
    f.shared = { notes: [], counts: [], removing: false };
    await click("[data-shared-problem] button");
    expect($("[data-shared-empty]")!.textContent).toBe("Nothing has been shared from here yet.");
  });
});
