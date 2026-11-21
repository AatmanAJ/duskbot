// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../../shared/runtime-events";
import { noteReplyEvent, noteReplyLanded, resetLiveReplies } from "@/state/live-reply";
import { LiveReplyBubble } from "./LiveReplyBubble";

const frame = (event: Partial<RuntimeEvent>) => ({ eventId: "e", threadId: "t", ...event }) as RuntimeEvent;
const stream = (text: string) => act(() => { noteReplyEvent(frame({ type: "content.delta", streamKind: "assistant_text", delta: text })); });
const words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen";

let root: Root;
let host: HTMLDivElement;
const shown = () => host.querySelector("[data-live-reply]")?.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "clearTimeout", "Date"] });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(LiveReplyBubble, { threadId: "t" })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetLiveReplies();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the live reply bubble", () => {
  it("shows a chunk that arrives at once a few words at a time, always whole words", async () => {
    stream(words);
    await act(async () => { vi.advanceTimersByTime(60); });
    const early = shown();
    expect(early.length).toBeGreaterThan(0);
    expect(early.length).toBeLessThan(words.length);
    expect(words.startsWith(early)).toBe(true);
    expect(words[early.length] === " " || early.length === words.length).toBe(true);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(shown()).toBe(words);
  });

  it("paces the next reply from its first word after the last one landed", async () => {
    stream(words);
    await act(async () => { vi.advanceTimersByTime(1500); });
    act(() => noteReplyLanded("t", "m1"));
    expect(shown()).toBe("");
    stream(`${words} again`);
    await act(async () => { vi.advanceTimersByTime(60); });
    expect(shown().length).toBeLessThan(words.length);
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(shown()).toBe(`${words} again`);
  });
});
