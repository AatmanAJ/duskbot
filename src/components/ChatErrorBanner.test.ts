import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ChatErrorBanner, ChatNotice } from "./ChatErrorBanner";

const source = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

describe("ChatErrorBanner", () => {
  it("renders nothing when there is no error", () => {
    expect(renderToStaticMarkup(createElement(ChatErrorBanner, { message: null, onDismiss: () => undefined }))).toBe("");
  });

  it("announces the error and offers a dismiss control", () => {
    const onDismiss = vi.fn();
    const markup = renderToStaticMarkup(createElement(ChatErrorBanner, { message: "Clipboard has no image", onDismiss }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Clipboard has no image");
    expect(markup).toContain('aria-label="Dismiss"');
    expect(markup).toContain('type="button"');
    // a neutral borderless card; only the pixel stop glyph says it is an error
    expect(markup).toContain("border-transparent bg-(--color-notice)");
    expect(markup).toContain('data-pixel-icon="stop"');
    expect(markup).not.toMatch(/bg-danger|border-danger|text-\[12px\]/);
  });

  it("reads a machine's words as one plain line, never shows them, and offers to copy them for support", () => {
    const markup = renderToStaticMarkup(createElement(ChatErrorBanner, { message: "502 Bad Gateway", onDismiss: () => undefined }));
    expect(markup).toContain("Something went wrong on the other end. Try again.");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("502 Bad Gateway");
    expect(markup).toContain(">Copy details</span>");
  });

  it("shows a sentence as it is, with nothing to expand", () => {
    const markup = renderToStaticMarkup(createElement(ChatErrorBanner, { message: "Clipboard has no image", onDismiss: () => undefined }));
    expect(markup).not.toContain("<details");
  });

  it("wraps a long message instead of widening the banner", () => {
    const markup = renderToStaticMarkup(createElement(ChatErrorBanner, { message: "Failed to fetch", onDismiss: () => undefined }));
    expect(markup).toContain('class="min-w-0 flex-1 break-words"');
  });

  it("is the banner both the chat and the room render", () => {
    for (const file of ["components/ChatView.tsx", "components/GroupView.tsx"]) {
      const text = source(file);
      expect(text).toContain("<ChatErrorBanner");
      expect(text).toContain('message={chatError}');
      expect(text).toContain('dispatch({ type: "error", message: null })');
    }
    const store = source("state/store.tsx");
    expect(store).toContain("useChatErrorClear(state.error, clearChatError)");
    expect(store).not.toContain('setTimeout(() => rawDispatch({ type: "error", message: null }), 6000)');
  });
});

describe("ChatNotice", () => {
  const markup = (notice: Parameters<typeof ChatNotice>[0]["notice"]) => renderToStaticMarkup(createElement(ChatNotice, { notice }));

  it("says which reference no longer resolves", () => {
    expect(markup(null)).toBe("");
    expect(markup({ kind: "thread-gone", botName: null })).toContain("That conversation is no longer here.");
    expect(markup({ kind: "thread-gone", botName: "Ada" })).toContain("That conversation is no longer here. Showing Ada instead.");
    expect(markup({ kind: "bot-gone", botName: null })).toContain("That bot is no longer here.");
    expect(markup({ kind: "bot-gone", botName: null })).toContain('role="status"');
  });

  it("says why a pressed Steer left pictures queued", () => {
    const text = markup({ kind: "steer-images", botName: null });
    expect(text).toContain("Pictures can&#x27;t join a turn that&#x27;s already running. Your message goes out when the bot is done.");
    expect(text).toContain('role="status"');
  });

  it("shows the server's own words when a deletion went through with something left to tidy", () => {
    const text = markup({ kind: "note", botName: null, text: "Deleted. gone-vps could not be reached, so the bot's computer there was left as it was." });
    expect(text).toContain("Deleted. gone-vps could not be reached, so the bot&#x27;s computer there was left as it was.");
    expect(text).toContain('role="status"');
  });

  it("shows in the room as well as the chat", () => {
    for (const file of ["components/ChatView.tsx", "components/GroupView.tsx"]) {
      expect(source(file)).toContain("<ChatNotice notice={notice} />");
    }
  });
});
