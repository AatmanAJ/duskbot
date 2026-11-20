// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettleFold } from "./settle-fold";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Run = { el: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions; onfinish: (() => void) | null; oncancel: (() => void) | null };
let runs: Run[] = [];
let root: Root;
let host: HTMLDivElement;

function Card({ settled }: { settled: boolean }) {
  const fold = useSettleFold<HTMLDivElement>(settled);
  return createElement("div", { ref: fold },
    settled
      ? createElement("div", { key: "row", "data-row": "" }, createElement("span", null, "Secrets"), createElement("span", { "data-settled-summary": "" }, "Saved · OpenAI API key"))
      : createElement("div", { key: "open", "data-open": "" }, createElement("input", { type: "password", "aria-label": "OpenAI API key" })));
}
const draw = (settled: boolean) => act(() => root.render(createElement(Card, { settled })));
const reduce = (on: boolean) => vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
  matches: on && query.includes("reduce"), media: query, addEventListener: () => {}, removeEventListener: () => {},
}) as unknown as MediaQueryList);
const runOn = (el: Element | null) => runs.filter((run) => run.el === el);

beforeEach(() => {
  runs = [];
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(function (this: HTMLElement, keyframes, options) {
    const run: Run = { el: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions, onfinish: null, oncancel: null };
    runs.push(run);
    return run as unknown as Animation;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("a secrets card settling", () => {
  it("shrinks the open card into its row: the card fades and shrinks from its top while the height folds and the corners tighten, then the summary slides in", () => {
    reduce(false);
    draw(false);
    draw(true);
    const wrapper = host.firstElementChild as HTMLElement;
    const ghost = wrapper.querySelector<HTMLElement>("[data-open]");
    expect(ghost, "the open card stays over the row until the fold is over").not.toBeNull();
    expect(ghost!.getAttribute("aria-hidden")).toBe("true");
    expect(ghost!.style.transformOrigin).toBe("50% 0");
    expect(wrapper.querySelector("[data-row]")).not.toBeNull();

    expect(runOn(ghost)[0]).toMatchObject({
      keyframes: [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.98)" }],
      options: { duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    });
    const fold = runOn(wrapper)[0]!;
    expect(fold.keyframes.map((frame) => frame.clipPath)).toEqual(["inset(0 round 24px)", "inset(0 round 18px)"]);
    expect(fold.options).toMatchObject({ duration: 220, easing: "cubic-bezier(0.645, 0.045, 0.355, 1)" });
    expect(runOn(wrapper.querySelector("[data-settled-summary]"))[0]).toMatchObject({
      keyframes: [{ opacity: 0, transform: "translateX(-4px)" }, { opacity: 1, transform: "none" }],
      options: { duration: 160, delay: 120 },
    });

    act(() => fold.onfinish!());
    expect(wrapper.querySelector("[data-open]")).toBeNull();
    expect(wrapper.style.position).toBe("");
  });

  it("only fades the summary in under reduced motion, keeping no card behind", () => {
    reduce(true);
    draw(false);
    draw(true);
    const wrapper = host.firstElementChild as HTMLElement;
    expect(wrapper.querySelector("[data-open]")).toBeNull();
    expect(runs.map((run) => run.keyframes)).toEqual([[{ opacity: 0 }, { opacity: 1 }]]);
    expect(runs[0]!.el.hasAttribute("data-settled-summary")).toBe(true);
  });

  it("stays still for a card that was already settled when it mounted", () => {
    reduce(false);
    draw(true);
    expect(runs).toHaveLength(0);
  });
});
