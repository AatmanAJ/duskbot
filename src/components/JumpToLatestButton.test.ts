import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JumpToLatestButton } from "./JumpToLatestButton";

const chatCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "chat.css"), "utf8");

describe("JumpToLatestButton", () => {
  it("draws a hairline ring so it stays separate from a card of the same tone under it", () => {
    const markup = renderToStaticMarkup(createElement(JumpToLatestButton, { onClick: () => {} }));
    expect(markup).toContain("ring-1 ring-ink/[0.14]");
  });

  it("lifts off the page with a deeper shadow in dark skins", () => {
    expect(chatCss).toMatch(/@container style\(--code-color-scheme: dark\) \{\s*\.chat-jump \{ --tw-shadow: [^}]*rgb\(0 0 0 \/ 0\.6\)/);
  });
});
