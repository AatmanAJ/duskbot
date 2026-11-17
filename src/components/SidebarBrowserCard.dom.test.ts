// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ state: {} as any, dispatch: vi.fn(), open: false, asked: [] as Array<[string, string | undefined, boolean]> }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }) }));
vi.mock("@/lib/local-browser", () => ({
  useLocalBrowser: (botId: string, threadId: string | undefined, enabled: boolean) => { f.asked.push([botId, threadId, enabled]); return { open: f.open, closed: null, known: true }; },
}));
import { SidebarBrowserCard } from "./SidebarBrowserCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  f.open = false; f.asked = [];
  f.state = { activeView: "chat", selectedId: "b1", bots: [{ id: "b1", name: "Pepper", threadId: "t1" }, { id: "b2", name: "Basil", browser: false }] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); MotionGlobalConfig.skipAnimations = false; });

const card = () => host.querySelector<HTMLElement>("[data-sidebar-browser-card]");
const render = async () => { await act(async () => { root.render(createElement(SidebarBrowserCard, { className: "mb-2" })); }); };
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

describe("the open bot's browser card above the spot", () => {
  it("is not there while the bot's browser is closed", async () => {
    await render();
    expect(f.asked.at(-1)).toEqual(["b1", "t1", true]);
    expect(card()).toBeNull();
  });

  it("shows while the browser is open, named for the bot, and opens its Computer tab", async () => {
    f.open = true;
    await render();
    expect(card()?.dataset.sidebarBrowserCard).toBe("b1");
    expect(card()?.textContent).toBe("Pepper's browser");
    await act(async () => { card()!.querySelector("button")!.click(); });
    expect(f.dispatch).toHaveBeenCalledWith({ type: "toggleComputer", open: true, botId: "b1" });
  });

  it("folds away once the server closes the idle browser, and comes back when the bot browses again", async () => {
    f.open = true;
    await render();
    expect(card()).not.toBeNull();
    f.open = false;
    await render();
    await settle();
    expect(card()).toBeNull();
    f.open = true;
    await render();
    expect(card()?.textContent).toBe("Pepper's browser");
  });

  it("never asks for a bot whose browser is off, or with no bot open", async () => {
    f.open = true;
    f.state.selectedId = "b2";
    await render();
    expect(f.asked.at(-1)?.[2]).toBe(false);
    expect(card()).toBeNull();
    f.state.activeView = "files";
    await render();
    expect(f.asked.at(-1)).toEqual(["", undefined, false]);
    expect(card()).toBeNull();
  });
});
