// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body?: unknown }>, dispatch: vi.fn(), refresh: vi.fn(async () => {}) }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: fixture.dispatch, refreshInstances: fixture.refresh }),
  api: async (path: string, init?: RequestInit) => { fixture.calls.push({ path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }); return {}; },
}));
const { ChatNotice } = await import("./ChatErrorBanner");

describe("the note a send with no AI gets", () => {
  it("offers the AI found on this computer, turns it on, and clears itself", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    flushSync(() => root.render(createElement(ChatNotice, { notice: { kind: "note", botName: null, text: "Claude is on this computer.", found: { instanceId: "claude", name: "Claude" } } })));
    expect(host.textContent).toContain("Claude is on this computer.");
    flushSync(() => host.querySelector<HTMLButtonElement>('[data-use-found-ai="claude"]')!.click());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.calls).toEqual([{ path: "/api/instances/claude", body: { chosen: true } }]);
    expect(fixture.refresh).toHaveBeenCalled();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "notice", notice: null });
    flushSync(() => root.render(createElement(ChatNotice, { notice: { kind: "note", botName: null, text: "Connect an AI first, so bots can answer." } })));
    expect(host.querySelector("[data-use-found-ai]")).toBeNull();
    flushSync(() => root.unmount());
  });
});
