// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  open: false,
  closed: null as null | { at: number; tabs: Array<{ title: string; url: string; image: string | null }> },
  sent: [] as unknown[],
  closes: [] as Array<[string, string | undefined]>,
  surface: null as null | { onMessage: (message: Record<string, unknown>) => void },
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: { config: { browserEngine: { engine: "chrome" } } } }), api: vi.fn() }));
vi.mock("../Avatar", () => ({ BotAvatar: () => null }));
vi.mock("@/lib/local-browser", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/local-browser")>(),
  useLocalBrowser: () => ({ open: f.open, closed: f.closed, known: true }),
  closeLocalBrowser: async (botId: string, threadId: string | undefined) => { f.closes.push([botId, threadId]); return true; },
}));
vi.mock("../browser/StreamSurface", async () => {
  const { useEffect } = await import("react");
  return {
    StreamSurface: (props: { onClient: (client: unknown) => void; onConnectedChange: (on: boolean) => void; onMessage: (message: Record<string, unknown>) => void }) => {
      useEffect(() => {
        props.onClient({ send: (input: unknown) => { f.sent.push(input); return true; } });
        props.onConnectedChange(true);
      }, []);
      f.surface = { onMessage: props.onMessage };
      return null;
    },
  };
});
import { LocalBrowserSection } from "./LocalBrowser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOT = { id: "b1", name: "Nova", threadId: "t1", browser: true } as never;
const TABS = [
  { tabId: "a", title: "Lisbon to Sintra", url: "https://www.cp.pt/en/tickets", active: true },
  { tabId: "b", title: "Pena Palace tickets", url: "https://www.parquesdesintra.pt/en", active: false },
  { tabId: "c", title: "Guesthouse Graça", url: "https://www.booking.com/hotel/graca", active: false },
];

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  f.open = true; f.closed = null; f.sent = []; f.closes = []; f.surface = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

const q = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector);
const render = (props: Record<string, unknown> = {}) => act(async () => { root.render(createElement(LocalBrowserSection, { bot: { ...(BOT as object), ...props } as never, after: createElement("p", { "data-cta": "" }, "Keep Nova working") })); });
const message = (value: Record<string, unknown>) => act(async () => { f.surface!.onMessage(value); });
const click = (selector: string) => act(async () => { q(selector)!.click(); });

describe("the compact browser in the Computer tab", () => {
  it("shows the bot's tabs, and selects, closes and opens tabs through the browser", async () => {
    await render();
    await message({ type: "tabs", tabs: TABS });
    const tabs = [...host.querySelectorAll<HTMLElement>("[data-local-browser-tab]")];
    expect(tabs.map((tab) => tab.querySelector("[dir=auto]")?.textContent)).toEqual(["Lisbon to Sintra", "Pena Palace tickets", "Guesthouse Graça"]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");

    await click('[data-local-browser-tab="b"]');
    expect(f.sent.at(-1)).toEqual({ type: "tabSelect", tabId: "b" });
    // chosen at once, before the browser answers
    expect(q('[data-local-browser-tab="b"]')!.getAttribute("aria-selected")).toBe("true");

    await click('[data-local-browser-tab-close="c"]');
    expect(f.sent.at(-1)).toEqual({ type: "tabClose", tabId: "c" });
    expect(q('[data-local-browser-tab="c"]')).toBeNull();

    await click("[data-local-browser-action=new-tab]");
    expect(f.sent.at(-1)).toEqual({ type: "tabNew" });
  });

  it("goes back, forward and reloads, and goes to a typed address on Enter", async () => {
    await render();
    await message({ type: "tabs", tabs: TABS });
    await message({ type: "nav", url: "https://www.cp.pt/en/tickets", loading: false, canGoBack: true, canGoForward: false });
    expect(q<HTMLInputElement>("[data-local-browser-address]")!.value).toBe("cp.pt/en/tickets");
    expect(q<HTMLButtonElement>("[data-local-browser-action=forward]")!.disabled).toBe(true);
    await click("[data-local-browser-action=back]");
    expect(f.sent.at(-1)).toEqual({ type: "history", delta: -1 });
    await click("[data-local-browser-action=reload]");
    expect(f.sent.at(-1)).toEqual({ type: "reload" });

    const field = q<HTMLInputElement>("[data-local-browser-address]")!;
    await act(async () => { field.focus(); });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "example.com");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { q<HTMLFormElement>("[data-local-browser-toolbar]")!.requestSubmit(); });
    expect(f.sent.at(-1)).toEqual({ type: "navigate", url: "https://example.com/" });
  });

  it("says the bot is browsing only while its turn acts in the browser, else that the browser is open", async () => {
    await render({ busy: false });
    expect(q("[data-local-browser-status]")!.textContent).toBe("Browser open");
    await render({ busy: true, turnStartedAt: Date.now() - 1_000 });
    expect(q("[data-local-browser-status]")!.textContent).toBe("Browser open");
    await message({ type: "pointer", phase: "click", x: 4, y: 4, sequence: 1 });
    expect(q("[data-local-browser-status]")!.textContent).toBe("Nova is browsing");
    await render({ busy: false });
    expect(q("[data-local-browser-status]")!.textContent).toBe("Browser open");
  });

  it("asks before closing the browser, and Cancel keeps it", async () => {
    await render();
    await message({ type: "tabs", tabs: TABS });
    await click("[data-local-browser-action=close]");
    expect(q("[role=alertdialog]")!.textContent).toBe("Close the browser? Nova’s tabs are saved.CancelClose");
    await click("[data-local-browser-action=close-cancel]");
    expect(q("[role=alertdialog]")).toBeNull();
    expect(f.closes).toEqual([]);

    await click("[data-local-browser-action=close]");
    await click("[data-local-browser-action=close-confirm]");
    expect(f.closes).toEqual([["b1", "t1"]]);
    expect(q("[data-local-browser=live]")).toBeNull();
    expect(q("[data-local-browser-action=start]")!.textContent).toBe("Start browser");
    expect([...host.querySelectorAll("[data-local-browser-closed-tab] [dir=auto]")].map((title) => title.textContent)).toEqual(["Lisbon to Sintra", "Pena Palace tickets", "Guesthouse Graça"]);
    expect(q("[data-cta]")).not.toBeNull();
  });

  it("lists what it worked on for an hour after the browser closed, then only the pill and the offer", async () => {
    f.open = false;
    f.closed = { at: Date.now() - 4 * 60_000, tabs: [{ title: "Lisbon to Sintra", url: "https://www.cp.pt/en/tickets", image: null }] };
    await render();
    expect(host.querySelectorAll("[data-local-browser-closed-tab]")).toHaveLength(1);
    expect(q("[data-local-browser-action=start]")).not.toBeNull();

    f.closed = { at: Date.now() - 61 * 60_000, tabs: f.closed.tabs };
    await render({ name: "Nova " });
    expect(q("[data-local-browser-recent]")).toBeNull();
    expect(q("[data-local-browser-action=start]")).not.toBeNull();
    expect(q("[data-cta]")).not.toBeNull();
  });

  it("starts the browser from the pill", async () => {
    f.open = false;
    await render();
    expect(q("[data-local-browser=live]")).toBeNull();
    await click("[data-local-browser-action=start]");
    expect(q("[data-local-browser=live]")).not.toBeNull();
    expect(f.surface).not.toBeNull();
  });

  it("widens the panel, and Escape brings it back without closing the panel around it", async () => {
    host.id = "bot-panel";
    host.setAttribute("role", "dialog");
    await render();
    await click("[data-local-browser-action=expand]");
    expect(q("[data-local-browser-action=expand]")!.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--side-panel-w")).not.toBe("320px");
    let panelSaw: boolean | null = null;
    const panel = (event: KeyboardEvent) => { panelSaw = event.defaultPrevented; };
    window.addEventListener("keydown", panel);
    await act(async () => { q("[data-local-browser-action=expand]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    window.removeEventListener("keydown", panel);
    expect(panelSaw).not.toBe(false);
    expect(q("[data-local-browser-action=expand]")!.getAttribute("aria-pressed")).toBe("false");
    expect(document.documentElement.style.getPropertyValue("--side-panel-w")).toBe("320px");
  });

  it("marks the tab the person holds, and hands it back", async () => {
    await render();
    await message({ type: "tabs", tabs: [{ ...TABS[0], held: true }, TABS[1]] });
    expect(q('[data-local-browser-tab="a"] [data-local-browser-held]')).not.toBeNull();
    expect(q('[data-local-browser-tab="b"] [data-local-browser-held]')).toBeNull();
    expect(q("[data-local-browser-held-line]")!.textContent).toBe("You’re using this tabHand back");
    await click("[data-local-browser-action=hand-back]");
    expect(f.sent.at(-1)).toEqual({ type: "releaseControl" });
  });
});
