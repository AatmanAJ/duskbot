// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browser = vi.hoisted(() => ({ open: false }));
vi.mock("@/lib/local-browser", () => ({ useLocalBrowser: () => ({ open: browser.open, known: true }) }));

const { useBrowserPanelReveal } = await import("./use-browser-panel-reveal");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = { busy: boolean };
const dispatch = vi.fn();
function Probe({ busy }: Props) {
  useBrowserPanelReveal({ bot: { id: "dusk", threadId: "t1", busy, browser: true }, active: true, dispatch });
  return null;
}

let root: ReturnType<typeof createRoot> | null = null;
const render = async (props: Props) => { await act(async () => root!.render(createElement(Probe, props))); };

beforeEach(() => {
  browser.open = false;
  dispatch.mockClear();
  (window as unknown as { duskDesktop: unknown }).duskDesktop = { platform: "darwin" };
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root?.unmount()); root = null; });

describe("the bot's browser opening during a turn", () => {
  it("opens the panel's Computer tab on the browser, once", async () => {
    await render({ busy: true });
    expect(dispatch).not.toHaveBeenCalled();
    browser.open = true;
    await render({ busy: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleComputer", open: true });
    await render({ busy: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("leaves the panel alone when the browser was already open, or no turn runs", async () => {
    browser.open = true;
    await render({ busy: true });
    await render({ busy: true });
    browser.open = false;
    await render({ busy: false });
    browser.open = true;
    await render({ busy: false });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
