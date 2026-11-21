// The rules the surfaces cannot do without, checked in the stylesheet itself (DOM tests run without it).
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./ambient.css", import.meta.url), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

it("keeps the gliding highlight out of the rows' flow and out of the way of every click", () => {
  const band = rule(".amb-band");
  expect(band).toContain("position: absolute");
  expect(band).toContain("pointer-events: none");
});

it("keeps a focused reply field's border as it was", () => {
  expect(css).not.toMatch(/\.amb-reply:focus-within\s*\{/);
});

it("lays the open island's mascots out in a wrapping grid: no sideways scroll or edge fade, four rows at most before it scrolls", () => {
  const grid = rule(".amb-strip");
  expect(grid).toContain("flex-wrap: wrap");
  expect(grid).toContain("justify-content: center");
  expect(grid).toContain("gap: var(--amb-strip-gap) 6px");
  expect(grid).toContain("max-height: calc(4 * var(--amb-cell-h) + 3 * var(--amb-strip-gap)");
  // exactly four whole rows tall, padding included
  expect(grid).toContain("box-sizing: border-box");
  expect(grid).not.toContain("scroll-snap-type");
  expect(grid).toContain("overflow-x: hidden");
  expect(grid).toContain("overflow-y: auto");
  expect(grid).not.toContain("mask-image");
});

it("paints the dock's flares through the window's overhang, flush with the body, so no seam shows at the screen's edge", () => {
  const ear = rule(".amb-dock .amb-ear");
  expect(ear).toContain("right: 0");
  expect(ear).toContain("border-right: var(--amb-over, 0px) solid var(--amb-panel)");
  expect(ear).toContain("box-sizing: content-box");
  expect(ear).toContain("background-repeat: no-repeat");
});
