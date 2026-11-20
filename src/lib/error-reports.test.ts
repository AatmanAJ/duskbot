import { describe, expect, it, vi } from "vitest";
import { createErrorReports } from "./error-reports";

describe("desktop error reports", () => {
  it("relays an error once through the bridge, five different ones at most, and nothing without a bridge", () => {
    const send = vi.fn(async () => true);
    const report = createErrorReports({ send }, () => "/chat");
    for (let n = 0; n < 3; n++) report(new TypeError("same"));
    for (let n = 0; n < 9; n++) report(new Error(`e${n}`));
    expect(send).toHaveBeenCalledTimes(5);
    expect(send.mock.calls[0]).toEqual([expect.objectContaining({ type: "TypeError", message: "same", path: "/chat" })]);
    expect(() => createErrorReports(undefined)(new Error("x"))).not.toThrow();
  });

  it("never reports the browser's ResizeObserver loop notice, which breaks nothing", () => {
    const send = vi.fn(async () => true);
    createErrorReports({ send })(new Error("ResizeObserver loop completed with undelivered notifications."));
    expect(send).not.toHaveBeenCalled();
  });
});
