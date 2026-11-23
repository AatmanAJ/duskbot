// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ setSaver: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/allowance-notice", () => ({
  useLimitReached: () => ({ report: { level: "over", saver: false, resetAt: Date.now() + 86_400_000 }, update: fixture.update }),
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
