import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIMPLE_BUBBLE_MAX } from "@/components/chat-bubble";

const css = readFileSync(new URL("./mobile.css", import.meta.url), "utf8");
const rule = (selector: string) => css.split("\n").find((line) => line.startsWith(`${selector} {`));

describe("message width on the phone", () => {
  it("still finds the desktop bubble cap it overrides", () => {
    expect(SIMPLE_BUBBLE_MAX).toContain("100%-82px");
  });

  it("lets a bot reply span the column and stops your own bubble at 85%", () => {
    expect(rule('.dusk-mobile [data-mobile-chat] [data-chat-bubble][class*="100%-82px"]')).toContain("max-width: 100%;");
    expect(rule('.dusk-mobile [data-mobile-chat] [data-message-row].items-end [data-chat-bubble][class*="100%-82px"]')).toContain("max-width: 85%;");
    expect(css).not.toMatch(/\[data-chat-bubble\]\[class\*="100%-82px"\] \{ max-width: min\(/);
  });
});
