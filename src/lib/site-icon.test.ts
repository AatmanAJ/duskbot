import { describe, expect, it } from "vitest";

import { appLogoUrl } from "./site-icon";

describe("an app's logo in a list", () => {
  it("comes from the app as a small PNG when Composio draws it as SVG", () => {
    expect(appLogoUrl("https://logos.composio.dev/api/gmail")).toBe("/api/site-icon?app=gmail");
    expect(appLogoUrl("https://logos.composio.dev/api/Google_Sheets")).toBe("/api/site-icon?app=google_sheets");
  });

  it("keeps any other address as it is", () => {
    expect(appLogoUrl("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(appLogoUrl("https://logos.composio.dev/api/a/b")).toBe("https://logos.composio.dev/api/a/b");
    expect(appLogoUrl("/src/assets/app-logos/gmail.svg")).toBe("/src/assets/app-logos/gmail.svg");
  });
});
