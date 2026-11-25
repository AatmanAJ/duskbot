// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/store")>(), api: fixture.api }));

import { BrowserPartLine } from "./BrowserPartLine";
import type { BrowserPart } from "@/lib/browser-part";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); fixture.api.mockReset(); });

it("Retry on the bot's browser download says so when the retry itself could not start", async () => {
  fixture.api.mockRejectedValue(new Error("The download server didn't answer."));
  await act(async () => { root.render(createElement(BrowserPartLine, { part: { phase: "failed" } as BrowserPart })); });
  const retry = host.querySelector("button")!;
  await act(async () => { retry.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(fixture.api).toHaveBeenCalledWith("/api/browser-engine/install", { method: "POST" });
  expect(host.querySelector("[role=alert]")?.textContent).toBeTruthy();
});
