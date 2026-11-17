// @vitest-environment happy-dom
import { act, createElement, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateRowHeight, TranscriptRows, TranscriptViewportContext, VIRTUAL_TRANSCRIPT_FROM, type TranscriptRow, type TranscriptViewport } from "./TranscriptRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW_PX = 40;
let host: HTMLDivElement;
let scroller: HTMLDivElement;
let root: Root;
let scrollTo: typeof HTMLElement.prototype.scrollTo;
let rect: typeof HTMLElement.prototype.getBoundingClientRect;

// happy-dom has no layout: the scroller reports a 400px viewport and every row its fixed height.
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.dataset.scroller !== undefined ? 400 : this.dataset.index !== undefined ? ROW_PX : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) { return this.dataset.scroller !== undefined ? 400 : 0; },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      const list = this.querySelector<HTMLElement>("[data-virtual-rows]");
      if (this.dataset.scroller === undefined || !list) return 0;
      const drawn = [...list.children].filter((child) => (child as HTMLElement).style.display !== "none").length;
      return Number.parseFloat(list.style.paddingTop) + Number.parseFloat(list.style.paddingBottom) + drawn * (ROW_PX + 16) - 16;
    },
  });
  rect = HTMLElement.prototype.getBoundingClientRect;
  // the list sits at the top of the scroller's content, so on screen it is scrolled up by the scroller's offset
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const top = this.dataset.virtualRows !== undefined ? -(this.closest<HTMLElement>("[data-scroller]")?.scrollTop ?? 0) : 0;
    return { top, bottom: top, left: 0, right: 600, width: 600, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
  const offsets = new WeakMap<HTMLElement, number>();
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) { return offsets.get(this) ?? 0; },
    set(this: HTMLElement, value: number) { offsets.set(this, value); },
  });
  scrollTo = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object" && options.top !== undefined) this.scrollTop = options.top;
  } as typeof HTMLElement.prototype.scrollTo;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
  HTMLElement.prototype.scrollTo = scrollTo;
  HTMLElement.prototype.getBoundingClientRect = rect;
  for (const name of ["scrollTop", "scrollHeight", "clientHeight"]) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
});

const row = (id: string, extra: Record<string, unknown> = {}): TranscriptRow => ({
  element: createElement("div", { key: id, className: "contents", "data-mid": id, ...extra }, createElement("p", null, id)),
  messageIds: [id],
  estimate: ROW_PX,
});
const rowsOf = (count: number) => Array.from({ length: count }, (_, index) => row(`m${index}`));

async function draw(rows: readonly TranscriptRow[], viewport: Partial<TranscriptViewport> | null) {
  const scrollRef = createRef<HTMLDivElement>();
  const columnRef = createRef<HTMLDivElement>();
  const value: TranscriptViewport | null = viewport && {
    scrollRef, columnRef, transcriptKey: "bot:thread", startAtEnd: true, focusMessageId: null, keepMounted: [], ...viewport,
  };
  const list: ReactNode = createElement(TranscriptRows, { rows });
  await act(async () => root.render(
    createElement("div", { ref: scrollRef, "data-scroller": "", style: { overflowY: "auto", height: 400 } },
      createElement("div", { ref: columnRef, style: { display: "flex", flexDirection: "column", gap: 16 } },
        value ? createElement(TranscriptViewportContext, { value }, list) : list)),
  ));
  scroller = host.querySelector<HTMLDivElement>("[data-scroller]")!;
}

const mounted = () => [...host.querySelectorAll<HTMLElement>("[data-mid]")].map((element) => element.dataset.mid);

describe("TranscriptRows", () => {
  it("draws every row as it was, with nothing in between, below the virtual threshold", async () => {
    await draw(rowsOf(VIRTUAL_TRANSCRIPT_FROM - 1), { });
    expect(mounted()).toHaveLength(VIRTUAL_TRANSCRIPT_FROM - 1);
    expect(host.querySelector("[data-virtual-rows]")).toBeNull();
    expect(host.querySelector("[data-mid]")?.className).toBe("contents");
  });

  it("draws every row outside a transcript viewport", async () => {
    await draw(rowsOf(VIRTUAL_TRANSCRIPT_FROM + 50), null);
    expect(mounted()).toHaveLength(VIRTUAL_TRANSCRIPT_FROM + 50);
  });

  it("skips rows that draw nothing, so they neither count nor take a slot", async () => {
    const rows: TranscriptRow[] = [...rowsOf(VIRTUAL_TRANSCRIPT_FROM - 1), { element: null, messageIds: ["gone"], estimate: 40 }, { element: false, messageIds: ["gone2"], estimate: 40 }];
    await draw(rows, {});
    expect(host.querySelector("[data-virtual-rows]")).toBeNull();
    expect(mounted()).toHaveLength(VIRTUAL_TRANSCRIPT_FROM - 1);
  });

  it("mounts only the rows near the bottom of a long transcript, and pads for the rest", async () => {
    const total = 2_000;
    await draw(rowsOf(total), {});
    const shown = mounted();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(60);
    expect(shown.at(-1)).toBe(`m${total - 1}`);
    const list = host.querySelector<HTMLElement>("[data-virtual-rows]")!;
    expect(Number.parseFloat(list.style.paddingTop)).toBeGreaterThan(ROW_PX * (total - 60));
    expect(Number.parseFloat(list.style.paddingBottom)).toBe(0);
    const first = host.querySelector<HTMLElement>("[data-mid]")!;
    expect(first.style.display).toBe("flex");
    expect(first.dataset.index).toBeDefined();
  });

  it("brings a search hit's row into range", async () => {
    const rows = rowsOf(2_000);
    await draw(rows, {});
    expect(mounted()).not.toContain("m900");
    expect(scroller.scrollTop).toBeGreaterThan(1_900 * ROW_PX);
    await draw(rows, { focusMessageId: "m900" });
    const afterFocus = scroller.scrollTop;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(afterFocus).toBeGreaterThan(800 * ROW_PX);
    expect(mounted()).toContain("m900");
  });

  it("keeps a row being edited mounted, hidden, while it is far from the viewport", async () => {
    await draw(rowsOf(2_000), { keepMounted: ["m3"] });
    const kept = host.querySelector<HTMLElement>('[data-mid="m3"]');
    expect(kept).not.toBeNull();
    expect(kept!.style.display).toBe("none");
    expect(mounted().filter((id) => id !== "m3").every((id) => Number(id!.slice(1)) > 1_900)).toBe(true);
  });

  it("follows a scroll to the top of the list", async () => {
    await draw(rowsOf(2_000), {});
    await act(async () => {
      scroller.scrollTop = 0;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(mounted()).toContain("m0");
  });
});

describe("estimateRowHeight", () => {
  it("grows with a bubble's text and keeps steps and cards to their usual size", () => {
    const short = estimateRowHeight([{ kind: "text", text: "hi" }]);
    const long = estimateRowHeight([{ kind: "text", text: "word ".repeat(400) }]);
    expect(long).toBeGreaterThan(short);
    expect(estimateRowHeight([{ kind: "activity" }])).toBeLessThan(short + 20);
    expect(estimateRowHeight([{ kind: "options" }])).toBeGreaterThan(short);
    expect(estimateRowHeight([{ kind: "text", text: "x".repeat(1_000_000) }])).toBeLessThanOrEqual(1_600);
  });
});
