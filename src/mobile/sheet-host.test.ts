// @vitest-environment happy-dom
import { act, createElement, useReducer, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

type State = { settingsOpen: boolean; bots: { id: string; name: string }[]; groups: [] };
type Action = { type: string; open?: boolean };
const reduce = (state: State, action: Action): State => ({ ...state, settingsOpen: action.open ?? state.settingsOpen });
let current: { state: State; dispatch: (action: Action) => void } | null = null;

vi.mock("@/state/store", () => ({ useStore: () => current! }));
vi.mock("@/components/lazy-screens", () => ({ BotSettingsDialog: () => null, RoomPanel: () => null }));
vi.mock("./sheets/registry", () => ({ SHEET_PAGES: {} }));
vi.mock("./sheets/sheets.css", () => ({}));
vi.mock("./Sheet", () => ({ Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => createElement("div", { "data-open": String(open) }, children) }));

const { panelOpenAction, SheetHost } = await import("./SheetHost");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; });

function Host({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, dispatch] = useReducer(reduce, { settingsOpen: false, bots: [{ id: "b", name: "Quill" }], groups: [] });
  current = { state, dispatch };
  return createElement(SheetHost, { sheet: { kind: "profile", id: "b" }, open, onClose, onOpenSheet: () => {}, onOpenChat: () => {} });
}

it("opens the bot's sheet again after it was closed from the phone", async () => {
  const host = document.createElement("div");
  root = createRoot(host);
  let open = false;
  const closes = vi.fn(() => { open = false; draw(); });
  const draw = () => root!.render(createElement(Host, { open, onClose: closes }));
  await act(async () => draw());
  for (let round = 0; round < 3; round++) {
    // the shell opens the sheet and the store's panel in one go
    open = true;
    await act(async () => { current!.dispatch(panelOpenAction({ kind: "profile", id: "b" })!); draw(); });
    expect(host.querySelector("[data-open]")?.getAttribute("data-open"), `open ${round}`).toBe("true");
    expect(current!.state.settingsOpen).toBe(true);
    // a swipe down: the shell closes the sheet, the store's panel follows
    open = false;
    await act(async () => draw());
    expect(current!.state.settingsOpen).toBe(false);
  }
  expect(closes).not.toHaveBeenCalled();
});

it("opens the computer on its tab and leaves a room to its own panel", () => {
  expect(panelOpenAction({ kind: "computer", botId: "b" })).toEqual({ type: "toggleComputer", open: true, botId: "b" });
  expect(panelOpenAction({ kind: "settings" })).toBeNull();
});
