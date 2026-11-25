import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutHint, shortcutInText, shortcutLabel } from "./ShortcutHint";

afterEach(() => vi.unstubAllGlobals());

describe("shortcut hints", () => {
  it.each([
    ["darwin", "⌘ N", "⌘ /"],
    ["win32", "Ctrl N", "Ctrl /"],
    ["linux", "Ctrl N", "Ctrl /"],
  ])("uses the existing bindings on %s", (platform, newBot, help) => {
    vi.stubGlobal("window", { duskDesktop: { platform } });
    expect(shortcutLabel("new-bot")).toBe(newBot);
    expect(shortcutLabel("shortcuts-cheat-sheet")).toBe(help);
    expect(shortcutLabel("close-panel")).toBe("Esc");
    const html = renderToStaticMarkup(createElement(ShortcutHint, { id: "new-bot" }));
    expect(html).toContain('<kbd aria-hidden="true"');
    expect(html).toContain(newBot);
  });

  it("writes a shortcut for a sentence as ⌘K on a Mac and Ctrl+K elsewhere", () => {
    expect(shortcutInText("command-palette", true)).toBe("⌘K");
    expect(shortcutInText("command-palette", false)).toBe("Ctrl+K");
    expect(shortcutInText("not-a-binding")).toBeUndefined();
  });

  it("does not invent a hint for an unknown action", () => {
    expect(shortcutLabel("not-a-binding")).toBeUndefined();
    expect(renderToStaticMarkup(createElement(ShortcutHint, { id: "not-a-binding" }))).toBe("");
  });
});
