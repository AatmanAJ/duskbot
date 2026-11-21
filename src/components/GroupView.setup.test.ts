import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SetupResponderRow } from "./GroupView";

const row = (checked: boolean) => renderToStaticMarkup(createElement(SetupResponderRow, { choice: "everyone", checked, title: "Everyone responds", hint: "Every bot in the group answers", onClick: () => {} }));

describe("room setup default responder", () => {
  it("draws a radio on every choice, filled only on the chosen one", () => {
    expect(row(false)).toContain('data-radio="off"');
    expect(row(false)).toContain("border-ink/24");
    expect(row(false)).toContain('aria-checked="false"');
    expect(row(true)).toContain('data-radio="on"');
    expect(row(true)).toContain('aria-checked="true"');
  });

  it("gives each choice its title and one plain line", () => {
    const html = row(false);
    expect(html).toContain("Everyone responds");
    expect(html).toContain("Every bot in the group answers");
  });
});
