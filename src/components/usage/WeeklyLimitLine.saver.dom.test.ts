// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ setSaver: vi.fn(), update: vi.fn(), reached: true }));
vi.mock("@/lib/allowance-notice", () => ({
  useLimitReached: () => (fixture.reached ? { report: { level: "over", saver: false, resetAt: Date.now() + 86_400_000 }, update: fixture.update } : null),
}));
vi.mock("@/lib/spend", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/spend")>(), setSaver: fixture.setSaver }));

import { WeeklyLimitLine } from "./WeeklyLimitLine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });

it("Saver mode that could not be turned on says so beside the limit, instead of doing nothing", async () => {
  fixture.setSaver.mockRejectedValue(new Error("Server unreachable"));
  await act(async () => { root.render(createElement(WeeklyLimitLine, { onSeeUsage: vi.fn() })); });
  const saver = [...host.querySelectorAll("button")].find((button) => button.textContent === "Saver mode")!;
  await act(async () => { saver.click(); });
  await act(async () => { await Promise.resolve(); });
  expect(fixture.update).not.toHaveBeenCalled();
  expect(host.querySelector("[role=alert]")?.textContent).toMatch(/saver mode/i);
});

it("an old Saver mode failure is gone when the limit comes round again", async () => {
  fixture.reached = true;
  fixture.setSaver.mockRejectedValue(new Error("Server unreachable"));
  await act(async () => { root.render(createElement(WeeklyLimitLine, { onSeeUsage: vi.fn() })); });
  const saver = [...host.querySelectorAll("button")].find((button) => button.textContent === "Saver mode")!;
  await act(async () => { saver.click(); });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector("[role=alert]")).not.toBeNull();
  fixture.reached = false;
  await act(async () => { root.render(createElement(WeeklyLimitLine, { onSeeUsage: vi.fn() })); });
  fixture.reached = true;
  await act(async () => { root.render(createElement(WeeklyLimitLine, { onSeeUsage: vi.fn() })); });
  expect(host.querySelector("[role=alert]")).toBeNull();
});
