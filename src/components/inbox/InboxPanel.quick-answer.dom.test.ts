// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/api", () => ({ api: vi.fn(async () => null) }));

import { initialState, StoreContext, type AppState } from "@/state/store";
import { closeInbox, openInbox, setInboxView } from "@/state/inbox";
import { approvalRow, inboxView } from "@/testing/inbox-fixture";
import { InboxPanel } from "./InboxPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const dispatch = vi.fn();
beforeEach(() => {
  dispatch.mockClear();
  setInboxView(inboxView());
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(() => { act(() => root.unmount()); closeInbox(); setInboxView(null); document.body.innerHTML = ""; });

it("Allow on an inbox row answers once and the row leaves the list at once, as a card answer does", async () => {
  openInbox();
  await act(async () => {
    root.render(createElement(StoreContext.Provider,
      { value: { state: { ...initialState, bots: [] } as AppState, dispatch, flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() } as never },
      createElement(InboxPanel)));
  });
  const allow = () => document.querySelector<HTMLButtonElement>(`[data-inbox-row="${approvalRow.id}"] [data-inbox-action="allow"]`);
  await act(async () => { allow()!.click(); });
  await act(async () => { allow()?.click(); });
  expect(dispatch.mock.calls.filter(([action]) => action.type === "decideRequest")).toHaveLength(1);
  expect(document.querySelector(`[data-inbox-row="${approvalRow.id}"]`)).toBeNull();
});
