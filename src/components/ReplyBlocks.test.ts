import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplyBlocks } from "./ReplyBlocks";
import { SIMPLE_BUBBLE_MAX } from "./chat-bubble";

const classOf = (markup: string, marker: string) => markup.match(new RegExp(`${marker}[^>]*class="([^"]*)"`))?.[1]?.split(" ") ?? [];

describe("ReplyBlocks", () => {
  it("lets a table take the whole transcript width on a phone, and keeps prose at bubble width", () => {
    const markup = renderToStaticMarkup(createElement(ReplyBlocks, {
      blocks: [{ kind: "prose", text: "Here are the numbers." }, { kind: "table", text: "| a | b |\n|---|---|\n| 1 | 2 |" }],
      render: (text: string) => text,
    }));
    expect(classOf(markup, "data-reply-table")).toEqual(expect.arrayContaining([SIMPLE_BUBBLE_MAX, "max-md:max-w-none"]));
    expect(classOf(markup, 'data-chat-bubble="simple"')).toContain(SIMPLE_BUBBLE_MAX);
    expect(classOf(markup, 'data-chat-bubble="simple"')).not.toContain("max-md:max-w-none");
  });
});
