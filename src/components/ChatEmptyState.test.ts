import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { EmptyChat } from "./ChatEmptyState";

const html = () => renderToStaticMarkup(createElement(EmptyChat, { bot: { id: "juniper", name: "Juniper" } as Bot }));

describe("a chat with no messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("on a computer says so only to a screen reader", () => {
    expect(html()).toContain('class="sr-only">No messages yet<');
  });

  it("on the phone says so on screen, so a new bot's chat never reads as a blank page", () => {
    vi.stubGlobal("document", { documentElement: { dataset: { mobileApp: "android" } } });
    expect(html()).not.toContain("sr-only");
    expect(html()).toMatch(/<p role="status"[^>]*>No messages yet<\/p>/);
  });
});
