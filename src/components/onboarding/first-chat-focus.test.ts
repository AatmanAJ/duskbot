// @vitest-environment happy-dom
// The first run closes on the chat with the message box ready to type in, even when the chat is drawn a few frames
// after the welcome goes, and never over a field the person has moved to.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { focusComposerWhenShown } from "../AskCard";

const frame = async (count = 1) => { for (let i = 0; i < count; i++) await new Promise((done) => requestAnimationFrame(() => done(null))); };
const composer = () => {
  const box = document.createElement("div");
  box.dataset.tour = "composer";
  const field = document.createElement("textarea");
  box.append(field);
  document.body.append(box);
  return field;
};

beforeEach(() => { document.body.innerHTML = ""; });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("focusComposerWhenShown", () => {
  it("waits for the chat behind the closing welcome, then focuses its message box", async () => {
    const welcome = document.createElement("div");
    welcome.dataset.welcome = "bring";
    welcome.setAttribute("role", "dialog");
    const next = document.createElement("button");
    welcome.append(next);
    document.body.append(welcome);
    next.focus();
    focusComposerWhenShown();
    await frame(2);
    welcome.remove();
    const field = composer();
    await frame(3);
    expect(document.activeElement).toBe(field);
  });

  it("leaves a field the person moved to alone", async () => {
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    const field = composer();
    focusComposerWhenShown();
    await frame(3);
    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(field);
  });

  it("never focuses on a touch screen, where it would pop the keyboard over the chat", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("pointer: coarse"), addEventListener() {}, removeEventListener() {} }));
    const field = composer();
    focusComposerWhenShown();
    await frame(3);
    expect(document.activeElement).not.toBe(field);
  });
});
