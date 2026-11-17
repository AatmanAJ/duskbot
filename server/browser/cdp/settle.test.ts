import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FrameTree } from "./frames.ts";
import { classifyChallenge, settleNote, settlePage, type PageProbe, type SettleTarget } from "./settle.ts";

const page = (over: Partial<PageProbe> = {}): PageProbe => ({
  title: "Shop", text: "Welcome to the shop", textLength: 2_500, nodes: 120, controls: 14, busy: false, scripts: [], iframes: [], selectors: [], ...over,
});

describe("bot-check interstitials", () => {
  it.each<[string, Partial<PageProbe>, string[], ReturnType<typeof classifyChallenge>]>([
    ["an ordinary page", {}, [], null],
    ["an ordinary page that loads DataDome's script", { scripts: ["https://js.datadome.co/tags.js"] }, [], null],
    ["Cloudflare's waiting room", { title: "Just a moment...", text: "Checking if the site connection is secure", textLength: 80, controls: 0 }, [], { vendor: "Cloudflare", state: "checking" }],
    ["Cloudflare's challenge script on an empty page", { textLength: 100, controls: 0, scripts: ["https://shop.example/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"] }, [], { vendor: "Cloudflare", state: "checking" }],
    // x.com and many others load the script on every page: a short page with things to act on is no check
    ["a short ordinary page that loads Cloudflare's script", { title: "Messages / X", text: "Messages\nNew message", textLength: 900, controls: 40,
      scripts: ["https://x.com/cdn-cgi/challenge-platform/scripts/jsd/main.js"] }, [], null],
    ["Cloudflare's block page", { title: "Attention Required! | Cloudflare", text: "Sorry, you have been blocked" }, [], { vendor: "Cloudflare", state: "blocked" }],
    ["a DataDome captcha", { textLength: 10, iframes: ["https://geo.captcha-delivery.com/captcha/?initialCid=x&t=fe"] }, [], { vendor: "DataDome", state: "needs-user" }],
    ["a DataDome block", { textLength: 10 }, ["https://geo.captcha-delivery.com/captcha/?initialCid=x&t=bv"], { vendor: "DataDome", state: "blocked" }],
    ["PerimeterX's press and hold", { selectors: ["#px-captcha"] }, [], { vendor: "PerimeterX", state: "needs-user" }],
    ["an Imperva incident", { text: "Request unsuccessful. Incapsula incident ID: 123-456" }, [], { vendor: "Imperva", state: "blocked" }],
    ["Imperva's script check", { textLength: 0, controls: 0, scripts: ["https://shop.example/_Incapsula_Resource?SWJIYLWA=abc"] }, [], { vendor: "Imperva", state: "checking" }],
    ["Akamai's access denied", { title: "Access Denied", text: "You don't have permission to access \"http://shop.example/\" on this server. Reference #18.abc" }, [], { vendor: "Akamai", state: "blocked" }],
    ["Akamai's interstitial", { selectors: ["#sec-if-cpt-container"] }, [], { vendor: "Akamai", state: "checking" }],
    ["an AWS WAF captcha", { selectors: ["awswaf-captcha"] }, [], { vendor: "AWS WAF", state: "needs-user" }],
    ["an AWS WAF challenge", { textLength: 0, scripts: ["https://abc.token.awswaf.com/abc/challenge.js"] }, [], { vendor: "AWS WAF", state: "checking" }],
    ["Vercel's checkpoint", { title: "Vercel Security Checkpoint", textLength: 50 }, [], { vendor: "Vercel", state: "checking" }],
    ["DDoS-Guard", { title: "DDoS-Guard", textLength: 50 }, [], { vendor: "DDoS-Guard", state: "checking" }],
    // no vendor's markers: the same general detector reads the wall by its words and its status
    ["Google's unusual traffic page", { title: "https://www.google.com/search?q=x", text: "Our systems have detected unusual traffic from your computer network.", textLength: 300, status: 429,
      iframes: ["https://www.google.com/recaptcha/api2/anchor?k=1&size=normal"] }, [], { vendor: "Site", state: "needs-user" }],
    ["a press and hold with no PerimeterX element", { title: "Before we continue", text: "Press & Hold to confirm you are a human (and not a bot).", textLength: 80 }, [], { vendor: "PerimeterX", state: "needs-user" }],
    ["a bare 403", { title: "403 Forbidden", text: "Forbidden", textLength: 9, status: 403 }, [], { vendor: "Site", state: "blocked" }],
    ["a bare 429", { title: "", text: "Too Many Requests", textLength: 17, status: 429 }, [], { vendor: "Site", state: "blocked" }],
    ["Reddit's network security block", { title: "Blocked", text: "You've been blocked by network security. To continue, log in to your Reddit account.", textLength: 120, status: 403 }, [], { vendor: "Site", state: "blocked" }],
    ["YouTube's sign-in wall for bots", { title: "YouTube", text: "Sign in to confirm you're not a bot", textLength: 400 }, [], { vendor: "Site", state: "blocked" }],
    ["a long article that mentions bot protection", { text: "How bot protection works: sites block suspicious traffic ...", textLength: 9_000, status: 200 }, [], null],
    ["a long 403 page with its own content", { title: "Members only", textLength: 3_000, status: 403 }, [], null],
  ])("%s", (_name, probe, frames, expected) => {
    expect(classifyChallenge(page(probe), frames)).toEqual(expected);
  });

  it("does not take a long article that mentions Cloudflare's markers for a check", () => {
    expect(classifyChallenge(page({ title: "Just a moment of your time: a long read", textLength: 40_000 }))).toBeNull();
  });
});

/** A page whose probe answers come from `script`, one per read, the last repeated. */
function fakePage(script: Array<PageProbe | "between">, frames: string[] = []): SettleTarget & { reads: number } {
  let reads = 0;
  const tree = {
    mainFrameId: "main",
    all: () => frames.map((url) => ({ url })),
    inWorld: async (_frameId: string, work: (session: unknown, contextId: number) => Promise<unknown>) => {
      const step = script[Math.min(reads++, script.length - 1)]!;
      if (step === "between") throw new Error("Execution context was destroyed.");
      return work({ send: async () => ({ result: { type: "object", value: step } }) }, 1);
    },
  } as unknown as FrameTree;
  return { frames: tree, loaded: async () => {}, get reads() { return reads; } };
}

describe("settling a page before it is read", () => {
  beforeEach(() => { vi.useFakeTimers({ now: 0 }); });
  afterEach(() => { vi.useRealTimers(); });

  async function settle(target: SettleTarget, options: { deadline?: number; fresh?: boolean } = {}) {
    const done = settlePage(target, { deadline: options.deadline ?? 100_000, ...(options.fresh !== undefined ? { fresh: options.fresh } : {}) });
    await vi.advanceTimersByTimeAsync(30_000);
    return done;
  }

  it("reads an ordinary page once and adds nothing", async () => {
    const target = fakePage([page()]);
    const report = await settle(target);
    expect(report).toEqual({});
    expect(target.reads).toBe(1);
    expect(settleNote(report)).toBeNull();
  });

  it("waits out a check that clears by itself, across the reload it ends with", async () => {
    const check = page({ title: "Just a moment...", textLength: 60, controls: 0 });
    const report = await settle(fakePage([check, check, check, "between", page()]));
    expect(report.challenge).toEqual({ vendor: "Cloudflare", state: "checking", cleared: true, waitedMs: 4_000 });
    expect(settleNote(report)).toBe("The site ran a Cloudflare bot check first; it cleared by itself after 4 s.");
  });

  it("reads a normal page that loads Cloudflare's script at once, every time", async () => {
    const dms = page({ title: "Messages / X", textLength: 900, controls: 40, scripts: ["https://x.com/cdn-cgi/challenge-platform/scripts/jsd/main.js"] });
    for (let read = 0; read < 3; read++) {
      const target = fakePage([dms]);
      expect(await settle(target)).toEqual({});
      expect(target.reads).toBe(1);
    }
  });

  it("waits only briefly on a site whose check already cleared in this browser", async () => {
    const check = page({ title: "Just a moment...", textLength: 60, controls: 0, host: "shop.example" });
    const cleared = new Set<string>();
    const first = settlePage(fakePage([check, check, page({ host: "shop.example" })]), { deadline: 100_000, cleared });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await first).challenge).toMatchObject({ cleared: true });
    expect([...cleared]).toEqual(["shop.example"]);
    const again = settlePage(fakePage([check]), { deadline: 100_000, cleared });
    await vi.advanceTimersByTimeAsync(30_000);
    expect((await again).challenge).toMatchObject({ cleared: false, waitedMs: 3_000 });
  });

  it("gives up after 15 s, and calls a Turnstile still showing then a check for a person", async () => {
    const check = page({ title: "Just a moment...", textLength: 60, controls: 0 });
    const lingering = await settle(fakePage([check]));
    expect(lingering.challenge).toMatchObject({ state: "checking", cleared: false, waitedMs: 15_000 });
    expect(settleNote(lingering)).toMatch(/still shows a Cloudflare bot check after 15 s\. Never click it, solve it or try to hide that you are a bot\. Do not wait or reload yourself: call request_sign_in with the site and human_check true now/);
    const turnstile = await settle(fakePage([check], ["https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2"]));
    expect(turnstile.challenge).toMatchObject({ state: "needs-user", cleared: false });
    expect(settleNote(turnstile)).toMatch(/still shows a Cloudflare bot check after 15 s\. Never click it/);
    expect(settleNote(turnstile)).toMatch(/waits it out, reloads once and tries the person's own connection before anyone is asked/);
  });

  it("does not wait on a check only a person or nobody can clear", async () => {
    const target = fakePage([page({ selectors: ["#px-captcha"] })]);
    const report = await settle(target);
    expect(report.challenge).toMatchObject({ vendor: "PerimeterX", state: "needs-user", waitedMs: 0 });
    expect(target.reads).toBe(1);
  });

  it("keeps a check's wait inside the call's deadline", async () => {
    const check = page({ title: "Just a moment...", textLength: 60, controls: 0 });
    const report = await settle(fakePage([check]), { deadline: 3_500 });
    expect(report.challenge?.waitedMs).toBe(3_000);
  });

  it("waits for skeletons to turn into content, then for the page to be still for a moment", async () => {
    const loading = page({ busy: true, nodes: 40, textLength: 10 });
    const target = fakePage([loading, loading, loading, page({ nodes: 90 }), page({ nodes: 120 }), page({ nodes: 120 })]);
    const report = await settle(target);
    expect(report).toEqual({});
    expect(target.reads).toBeGreaterThanOrEqual(6);
  });

  it("stops waiting on placeholders after 2 s and says so", async () => {
    const report = await settle(fakePage([page({ busy: true })]));
    expect(report).toEqual({ stillBusy: true });
    expect(settleNote(report)).toMatch(/still loading after 2 s/);
  });

  it("gives a fresh, nearly empty document up to 1 s to draw itself", async () => {
    const empty = page({ controls: 0, textLength: 0, nodes: 5 });
    const drawn = await settle(fakePage([empty, empty, empty, page()]), { fresh: true });
    expect(drawn).toEqual({});
    const blank = fakePage([empty]);
    expect(await settle(blank, { fresh: true })).toEqual({});
    expect(blank.reads).toBeLessThanOrEqual(12);
    const seen = fakePage([empty]);
    await settle(seen);
    expect(seen.reads).toBe(1);
  });
});
