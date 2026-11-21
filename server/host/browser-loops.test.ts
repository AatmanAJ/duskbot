import { describe, expect, it } from "vitest";

import { createBrowserLoops, SAME_STEP_LIMIT, terminalKind, type BrowserStop } from "./browser-loops.ts";

const text = (value: string, isError = false) => ({ ...(isError ? { isError } : {}), content: [{ type: "text", text: value }] });
const UNCHANGED = text("Clicked e12. The visible text of the page did not change.");

function harness() {
  const stops: BrowserStop[] = [];
  const loops = createBrowserLoops({ stop: (stop) => stops.push(stop) });
  return { stops, loops, open: (url: string) => loops.answer("t1", "agent_browser_navigate", { url }, text(`Opened ${url}`)) };
}

describe("browser loop breaker", () => {
  it("stops the run on the third identical step that did nothing, and names the site", () => {
    const h = harness();
    h.open("https://shop.example.com/cart");
    for (let i = 1; i < SAME_STEP_LIMIT; i += 1) expect(h.loops.answer("t1", "agent_browser_click", { ref: "e12" }, UNCHANGED)).toBe(UNCHANGED);
    const stopped = h.loops.answer("t1", "agent_browser_click", { ref: "e12" }, UNCHANGED);
    expect(stopped.isError).toBe(true);
    expect(h.stops).toEqual([{ threadId: "t1", blocker: { kind: "loop", site: "shop.example.com" }, cause: "the same browser step did nothing 3 times on shop.example.com" }]);
  });

  it("starts the count again when the step changes, the page changes, or a snapshot reads in between does not", () => {
    const h = harness();
    h.loops.answer("t1", "agent_browser_click", { ref: "e1" }, UNCHANGED);
    h.loops.answer("t1", "agent_browser_click", { ref: "e1" }, UNCHANGED);
    h.loops.answer("t1", "agent_browser_click", { ref: "e2" }, UNCHANGED);
    h.loops.answer("t1", "agent_browser_click", { ref: "e2" }, text("Text that appeared on the page: Added."));
    h.loops.answer("t1", "agent_browser_click", { ref: "e2" }, UNCHANGED);
    h.loops.answer("t1", "agent_browser_snapshot", {}, text("- button e2"));
    h.loops.answer("t1", "agent_browser_click", { ref: "e2" }, UNCHANGED);
    expect(h.stops).toEqual([]);
    h.loops.answer("t1", "agent_browser_click", { ref: "e2" }, UNCHANGED);
    expect(h.stops).toHaveLength(1);
  });

  it("tells the bot a refused sign-in is final, then stops it the moment it acts on that site again", () => {
    const h = harness();
    h.open("https://bank.example.com/login");
    const told = h.loops.answer("t1", "agent_browser_click", { ref: "e3" }, text("Text that appeared on the page: Incorrect password. Try again."));
    expect(told.content?.at(-1)?.text).toContain("on bank.example.com, the sign-in details were refused. That is final");
    expect(h.stops).toEqual([]);
    h.loops.answer("t1", "agent_browser_fill", { ref: "e1", text: "other" }, text("Filled e1."));
    expect(h.stops).toEqual([expect.objectContaining({ blocker: { kind: "credentials", site: "bank.example.com" } })]);
  });

  it("stops a return to a site that blocks automated visitors, and forgets it all at the turn's end", () => {
    const h = harness();
    h.open("https://tickets.example.com");
    h.loops.answer("t1", "agent_browser_snapshot", {}, text("Access denied. You have been blocked."));
    h.loops.settle("t1");
    h.open("https://tickets.example.com");
    expect(h.stops).toEqual([]);
    h.loops.answer("t1", "agent_browser_snapshot", {}, text("Access denied."));
    h.open("https://tickets.example.com/again");
    expect(h.stops).toEqual([expect.objectContaining({ blocker: { kind: "blocked", site: "tickets.example.com" } })]);
  });

  it("reads block words only on a short page", () => {
    expect(terminalKind("Access denied")).toBe("blocked");
    expect(terminalKind(`${"An article about how access denied errors work. ".repeat(100)}`)).toBeNull();
    expect(terminalKind("Your card was declined.")).toBe("credit");
  });
});

describe("a site that says to slow down", () => {
  it("tells the bot once per site to pause its checklist, and never stops the run for it", () => {
    const h = harness();
    h.open("https://x.com/messages");
    const limited = text("Clicked e40. Text that appeared on the page: You are sending messages too fast. Try again later.");
    const first = h.loops.answer("t1", "agent_browser_click", { ref: "e40" }, limited);
    expect(first.content?.at(-1)?.text).toContain("call checklist pause");
    expect(first.isError).toBeUndefined();
    expect(h.loops.answer("t1", "agent_browser_click", { ref: "e41" }, limited)).toBe(limited);
    expect(h.stops).toEqual([]);
  });

  it("does not read a long page that merely mentions a rate limit as one", () => {
    const h = harness();
    const article = text(`Opened https://blog.example.com/post. ${"How API rate limits work and why you should slow down. ".repeat(100)}`);
    expect(h.loops.answer("t1", "agent_browser_navigate", { url: "https://blog.example.com/post" }, article)).toBe(article);
  });
});
