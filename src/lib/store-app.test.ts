// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { PANEL_TABS } from "@/components/bot-panel/page-registry";
import { panelTabs, screenViewAllowed, storeApp } from "./store-app";

afterEach(() => { delete document.documentElement.dataset.mobileApp; });

describe("store app", () => {
  it("is the native phone app only, never the desktop or the phone page in a browser", () => {
    expect(storeApp()).toBe(false);
    document.documentElement.dataset.mobileApp = "web";
    expect(storeApp()).toBe(false);
    for (const kind of ["ios", "android"]) {
      document.documentElement.dataset.mobileApp = kind;
      expect(storeApp()).toBe(true);
    }
  });

  it("keeps the computer tab, and with it the screen view, everywhere, the iPhone included", () => {
    for (const kind of ["web", "android", "ios"]) {
      document.documentElement.dataset.mobileApp = kind;
      expect(screenViewAllowed()).toBe(true);
      expect(panelTabs()).toEqual(PANEL_TABS);
    }
  });
});
