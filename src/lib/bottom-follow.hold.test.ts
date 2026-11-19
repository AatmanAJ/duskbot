// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { growthHold } from "./bottom-follow";

const CLIENT = 600;
let scroller: HTMLDivElement, transcript: HTMLDivElement, height = 1000;

function row(top: number, arrival?: "start" | "end") {
  const el = document.createElement("div");
  if (arrival) el.setAttribute("data-arrival", arrival);
  el.getBoundingClientRect = () => ({ top: top - scroller.scrollTop }) as DOMRect;
  transcript.append(el);
  return el;
}

beforeEach(() => {
  scroller = document.createElement("div");
  transcript = document.createElement("div");
  scroller.append(transcript);
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => CLIENT });
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  height = 1000;
  scroller.scrollTop = 400;
});

describe("a reply growing while the transcript follows its end", () => {
  it("is followed while its top stays in view", () => {
    row(700, "start");
    height = 1100;
    expect(growthHold(scroller, transcript)).toBeNull();
  });

  it("stops the follow once its top would leave the view: its top rests just under the header", () => {
    row(700, "start");
    height = 1600;
    expect(growthHold(scroller, transcript)).toBe(660);
  });

  it("leaves growth after the person's own message to the usual follow", () => {
    row(700, "start");
    row(900, "end");
    height = 1600;
    expect(growthHold(scroller, transcript)).toBeNull();
  });
});
