import { describe, expect, it } from "vitest";

import { PURCHASE_REFUSAL, PurchaseGate } from "./purchase-gate.ts";

const checkout = {
  content: [{ type: "text", text: 'Page t1: "Checkout" at https://shop.example/checkout\n- textbox "Card number" [ref=e3]\n- button "Apply" [ref=e4]\n- button "Place your order" [ref=e7]' }],
};
const agentBrowserSnapshot = { content: [{ type: "text", text: "https://shop.example/product/1\n- button \"Buy now\" [ref=e2]\n- button \"Add to cart\" [ref=e3]" }] };

function at(page: unknown, now = { t: 0 }) {
  const gate = new PurchaseGate(() => now.t);
  gate.observe("s1", page);
  return { gate, now };
}

describe("the browser's purchase gate", () => {
  it("refuses Place order by ref until the person confirmed, then lets exactly one through", () => {
    const { gate } = at(checkout);
    expect(gate.check("s1", "agent_browser_click", { ref: "e4" })).toBeNull();
    expect(gate.check("s1", "agent_browser_click", { ref: "e7" })).toBe(PURCHASE_REFUSAL);
    gate.grant("s1");
    expect(gate.check("s1", "agent_browser_click", { ref: "e7" })).toBeNull();
    gate.observe("s1", { content: [{ type: "text", text: "Clicked e7." }] });
    expect(gate.check("s1", "agent_browser_click", { ref: "e7" })).toBe(PURCHASE_REFUSAL);
  });

  it("gives the confirmation back when the click failed", () => {
    const { gate } = at(checkout);
    gate.grant("s1");
    expect(gate.check("s1", "agent_browser_click", { ref: "e7" })).toBeNull();
    gate.observe("s1", { isError: true, content: [{ type: "text", text: "The element is covered." }] });
    expect(gate.check("s1", "agent_browser_click", { ref: "e7" })).toBeNull();
  });

  it("reads agent-browser's @refs, selectors and text, Enter on a checkout page and a batch step", () => {
    const { gate } = at(agentBrowserSnapshot);
    expect(gate.check("s1", "agent_browser_click", { selector: "@e2" })).toBe(PURCHASE_REFUSAL);
    expect(gate.check("s1", "agent_browser_click", { selector: "@e3" })).toBeNull();
    expect(gate.check("s1", "agent_browser_click", { selector: 'button:has-text("Buy now")' })).toBe(PURCHASE_REFUSAL);
    expect(gate.check("s1", "agent_browser_click", { selector: "#place-order" })).toBe(PURCHASE_REFUSAL);
    expect(gate.check("s1", "agent_browser_click", { text: "Place order" })).toBe(PURCHASE_REFUSAL);
    expect(gate.check("s1", "agent_browser_press", { key: "Enter" })).toBeNull();

    const onCheckout = at(checkout).gate;
    expect(onCheckout.check("s1", "agent_browser_press", { key: "Enter" })).toBe(PURCHASE_REFUSAL);
    expect(onCheckout.check("s1", "agent_browser_fill", { ref: "e3", text: "4242", submit: true })).toBe(PURCHASE_REFUSAL);
    expect(onCheckout.check("s1", "agent_browser_fill", { ref: "e3", text: "4242" })).toBeNull();
    expect(onCheckout.check("s1", "agent_browser_batch", { steps: [{ do: "fill", ref: "e3", text: "4242" }, { do: "click", ref: "e7" }] })).toBe(PURCHASE_REFUSAL);
  });

  it("a confirmation lasts ten minutes and stays with its own browser", () => {
    const { gate, now } = at(checkout);
    gate.observe("s2", checkout);
    gate.grant("s1");
    expect(gate.check("s2", "agent_browser_click", { ref: "e7" })).toBe(PURCHASE_REFUSAL);
    now.t = 11 * 60_000;
    expect(gate.check("s1", "agent_browser_click", { ref: "e7" })).toBe(PURCHASE_REFUSAL);
  });
});
