// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Bot } from "@/state/store";

vi.mock("@/lib/export-transcript", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/export-transcript")>(),
  copyTranscriptToClipboard: vi.fn(async () => true),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: vi.fn() }) };
});

import { COPY_FEEDBACK_MS } from "@/lib/copy-text";
import { useChatMoreItems } from "./ChatMoreMenu";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pepper: Bot = {
  id: "pepper", threadId: "thread-pepper", name: "Pepper", title: "", description: "", notifications: true, color: "orange",
  unread: false, modelSelection: { instanceId: "claude", model: "test" },
  messages: [{ id: "m1", role: "assistant", text: "Your train leaves at 9.", createdAt: new Date().toISOString() }],
} as unknown as Bot;

let latest: SidebarMenuItem[] = [];
function Probe() {
  latest = useChatMoreItems(pepper).items;
  return null;
}

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });

const copyStatus = () => {
  const trailing = latest.find((item) => item.key === "copy")?.trailing;
  return trailing ? renderToStaticMarkup(trailing as never) : "";
};

it("Copied shows after copying the conversation, then clears like every other copy in the app", async () => {
  await act(async () => { root.render(createElement(Probe)); });
  await act(async () => { latest.find((item) => item.key === "copy")!.onSelect!(); });
  expect(copyStatus()).toContain("Copied");
  await act(async () => { vi.advanceTimersByTime(COPY_FEEDBACK_MS + 50); });
  expect(copyStatus()).toBe("");
});
