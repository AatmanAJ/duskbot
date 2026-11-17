import { expect, test } from "vitest";
import { KPI_IDS, KPI_KEY, loadLayout, moveTo, normalOrder, saveLayout, slotAt, tintOf, type KpiLayout } from "./kpi-layout";

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

test("nothing stored gives today's strip: default order, revenue green, the rest plain", () => {
  const layout = loadLayout(memory());
  expect(layout.order).toEqual([...KPI_IDS]);
  expect(tintOf(layout, "revenue")).toBe("green");
  expect(tintOf(layout, "visitors")).toBe("none");
});

test("order and colours survive a save and load", () => {
  const store = memory();
  const layout: KpiLayout = { order: moveTo([...KPI_IDS], "mrr", 0), tints: { visitors: "purple", revenue: "none" } };
  saveLayout(layout, store);
  const back = loadLayout(store);
  expect(back.order.slice(0, 2)).toEqual(["mrr", "visitors"]);
  expect(tintOf(back, "visitors")).toBe("purple");
  expect(tintOf(back, "revenue")).toBe("none");
});

test("saving the default layout clears the stored key", () => {
  const store = memory();
  saveLayout({ order: ["signups", ...KPI_IDS.filter((id) => id !== "signups")], tints: {} }, store);
  expect(store.data.has(KPI_KEY)).toBe(true);
  saveLayout({ order: [...KPI_IDS], tints: { revenue: "green" } }, store);
  expect(store.data.has(KPI_KEY)).toBe(false);
});

test("a broken or stale stored value falls back without losing cards", () => {
  const store = memory();
  store.setItem(KPI_KEY, "{not json");
  expect(loadLayout(store).order).toEqual([...KPI_IDS]);
  store.setItem(KPI_KEY, JSON.stringify({ order: ["gone", "bounce rate", "bounce rate", "visitors"], tints: { visitors: "neon", signups: "blue" } }));
  const layout = loadLayout(store);
  expect(layout.order).toHaveLength(KPI_IDS.length);
  expect(layout.order.slice(0, 3)).toEqual(["bounce rate", "visitors", "revenue"]);
  expect(layout.tints).toEqual({ signups: "blue" });
  expect(normalOrder(null)).toEqual([...KPI_IDS]);
});

test("moveTo shifts one card and clamps at the ends", () => {
  const order = [...KPI_IDS];
  expect(moveTo(order, "visitors", 1).slice(0, 2)).toEqual(["revenue", "visitors"]);
  expect(moveTo(order, "visitors", -1)).toBe(order);
  expect(moveTo(order, "signups", 99).at(-1)).toBe("signups");
});

test("slotAt finds the box under a point", () => {
  const boxes = [{ left: 0, top: 0, width: 100, height: 50 }, { left: 106, top: 0, width: 100, height: 50 }];
  expect(slotAt(boxes, 150, 20)).toBe(1);
  expect(slotAt(boxes, 103, 20)).toBeNull();
});
