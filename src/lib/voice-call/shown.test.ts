import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteShownWords, untilShown, wordCount } from "./shown";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  noteShownWords("t", null);
  vi.useRealTimers();
});

describe("untilShown", () => {
  it("holds a sentence back until the chat shows its words", async () => {
    noteShownWords("t", 3);
    let said = false;
    void untilShown("t", 8).then(() => { said = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(said).toBe(false);
    noteShownWords("t", 6);
    await vi.advanceTimersByTimeAsync(10);
    expect(said).toBe(false);
    noteShownWords("t", 9);
    await vi.advanceTimersByTimeAsync(0);
    expect(said).toBe(true);
  });

  it("never holds it when nothing streams there, or for longer than its cap", async () => {
    await expect(untilShown("elsewhere", 50)).resolves.toBeUndefined();
    noteShownWords("t", 1);
    let said = false;
    void untilShown("t", 50, 3_000).then(() => { said = true; });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(said).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(said).toBe(true);
  });

  it("counts words, not markdown or punctuation", () => {
    expect(wordCount("**Sure** — two meetings, at 10:30.")).toBe(5);
  });
});
