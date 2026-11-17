import { describe, expect, it } from "vitest";

import { askLocalBrowser, blankPage, keepView, keptKey, keptView, minutesSince, pageTitle, parseLocalBrowser, tabLetter } from "./local-browser";

describe("local browser", () => {
  it("reads the server's answer, giving each kept screen its own address", () => {
    expect(parseLocalBrowser({ open: false, closed: { at: 5, tabs: [{ title: "Docs", url: "https://example.com/", image: true }, { title: "", url: "https://iana.org/", image: false }, { url: 3 }] } }, "b1", "t1"))
      .toEqual({ open: false, closed: { at: 5, tabs: [
        { title: "Docs", url: "https://example.com/", image: "/api/bots/b1/browser/recent/0?threadId=t1&at=5" },
        { title: "", url: "https://iana.org/", image: null },
      ] } });
    expect(parseLocalBrowser({ open: true, closed: null }, "b1", undefined)).toEqual({ open: true, closed: null });
    expect(parseLocalBrowser(null, "b1", undefined)).toEqual({ open: false, closed: null });
  });

  it("keeps what a bot's view last showed, per bot and conversation, for the next time it opens", () => {
    const key = keptKey("b1", "t1");
    expect(keptView(key)).toEqual({});
    keepView(key, { state: { open: true, closed: null } });
    keepView(key, { tabs: [{ tabId: "a", title: "Cat", url: "https://en.wikipedia.org/wiki/Cat", active: true }], frame: "data:image/jpeg;base64,AA" });
    expect(keptView(key)).toEqual({ state: { open: true, closed: null }, tabs: [{ tabId: "a", title: "Cat", url: "https://en.wikipedia.org/wiki/Cat", active: true }], frame: "data:image/jpeg;base64,AA" });
    expect(keptView(keptKey("b1", undefined))).toEqual({});
    expect(keptView(keptKey("b2", "t1"))).toEqual({});
  });

  it("asks once more after a failed answer before counting the browser as closed", async () => {
    const waits: number[] = [];
    const wait = async (ms: number) => { waits.push(ms); };
    let calls = 0;
    const flaky = async () => { calls++; if (calls === 1) throw new Error("blip"); return { open: true, closed: null }; };
    await expect(askLocalBrowser(flaky, wait, new AbortController().signal)).resolves.toEqual({ open: true, closed: null });
    expect(calls).toBe(2);
    expect(waits).toHaveLength(1);
    calls = 0;
    const down = async () => { calls++; throw new Error("down"); };
    await expect(askLocalBrowser(down, wait, new AbortController().signal)).rejects.toThrow("down");
    expect(calls).toBe(2);
    const stopped = new AbortController();
    stopped.abort();
    calls = 0;
    await expect(askLocalBrowser(down, wait, stopped.signal)).rejects.toThrow("down");
    expect(calls).toBe(1);
  });

  it("names a page by its site", () => {
    expect(tabLetter("Log in", "https://wise.com/login")).toBe("W");
    expect(tabLetter("Notes", "about:blank")).toBe("N");
    expect(pageTitle("en.wikipedia.org/wiki/Cat", "https://en.wikipedia.org/wiki/Cat")).toBe("");
    expect(pageTitle("example.com", "https://example.com/")).toBe("");
    expect(pageTitle("Cat - Wikipedia", "https://en.wikipedia.org/wiki/Cat")).toBe("Cat - Wikipedia");
    expect(["", "about:blank", "chrome://newtab/", "chrome://new-tab-page/"].every(blankPage)).toBe(true);
    expect(blankPage("https://example.com/")).toBe(false);
    expect(minutesSince(0, 4 * 60_000 + 59_000)).toBe(4);
  });
});
