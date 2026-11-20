// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PaymentLine } from "./SettingsSheet";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const payment = { name: "Night shift", fixBy: Date.UTC(2026, 11, 21, 12) };

it("says when the cloud keeps running until, with Update card only where the dashboard may be linked", () => {
  const onUpdate = vi.fn();
  act(() => root.render(createElement(PaymentLine, { payment, onUpdate })));
  expect(host.querySelector("[role=status]")!.textContent).toBe("The last payment didn't go through. Night shift keeps running until Dec 21, 2026.");
  act(() => host.querySelector("button")!.click());
  expect(onUpdate).toHaveBeenCalledOnce();
  act(() => root.render(createElement(PaymentLine, { payment, onUpdate: null })));
  expect(host.querySelector("[data-payment-notice]")).not.toBeNull();
  expect(host.querySelector("button")).toBeNull();
});
