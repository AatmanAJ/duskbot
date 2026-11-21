import { describe, expect, it } from "vitest";

import { RECENT_TABS_LIMIT, RECENT_TABS_MS, RecentTabs, within } from "./browser-recent-tabs.ts";

describe("RecentTabs", () => {
  it("keeps the closed tabs for 30 minutes, the active one first, and only pages a person would know", () => {
    let now = 1_000;
    const recent = new RecentTabs({ now: () => now });
    recent.record("bot-a", [
      { title: "Docs", url: "https://example.com/docs", image: null },
      { title: "", url: "about:blank", image: Buffer.from("x") },
      { title: "Invoice", url: "https://user:secret@pay.example.com/new", active: true, image: Buffer.from("jpeg") },
      { title: "Settings", url: "chrome://settings", image: null },
    ]);
    expect(recent.get("bot-a")).toEqual({ at: 1_000, tabs: [
      { title: "Invoice", url: "https://pay.example.com/new", image: Buffer.from("jpeg") },
      { title: "Docs", url: "https://example.com/docs", image: null },
    ] });
    now += 60 * 60_000 - 1;
    expect(recent.get("bot-a")?.tabs).toHaveLength(2);
    now += 1;
    expect(recent.get("bot-a")).toBeNull();
  });

  it("forgets a session that closed with nothing to show, and keeps at most the limit", () => {
    const recent = new RecentTabs();
    recent.record("bot-a", Array.from({ length: 12 }, (_, at) => ({ title: `Tab ${at}`, url: `https://example.com/${at}`, image: null })));
    expect(recent.get("bot-a")?.tabs).toHaveLength(RECENT_TABS_LIMIT);
    recent.record("bot-a", [{ title: "", url: "about:blank", image: null }]);
    expect(recent.get("bot-a")).toBeNull();
  });

  it("gives up on a picture that does not come in time", async () => {
    expect(await within(new Promise(() => undefined), 5)).toBeNull();
    expect(await within(Promise.reject(new Error("no")), 5)).toBeNull();
    expect(await within(Promise.resolve(3), 5)).toBe(3);
  });

  it("keeps a finished conversation's tabs beside what the browser later closed with, for the same 30 minutes", () => {
    let now = 0;
    const recent = new RecentTabs({ now: () => now });
    recent.add("bot-a", [{ title: "Form", url: "https://httpbin.org/forms/post", image: Buffer.from("jpg") }, { title: "", url: "about:blank", image: null }]);
    now = 60_000;
    recent.add("bot-a", [{ title: "Wiki", url: "https://en.wikipedia.org/", image: null }]);
    expect(recent.get("bot-a")?.tabs.map((tab) => tab.title)).toEqual(["Wiki", "Form"]);
    recent.record("bot-a", [{ title: "Last", url: "https://example.com/", image: null, active: true }]);
    expect(recent.get("bot-a")).toMatchObject({ at: 60_000, tabs: [{ title: "Last" }, { title: "Wiki" }, { title: "Form" }] });
    now = 60_000 + RECENT_TABS_MS;
    expect(recent.get("bot-a")).toBeNull();
  });
});
