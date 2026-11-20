// A bot's sign-ins outlive its browser on real Chrome: a graceful stop writes the cookies, and a crash afterwards does
// not reset the profile.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "../testing/host-timeout.ts";
import { FixtureServer } from "./cdp/testing/fixtures.ts";
import { CHROME } from "./cdp/testing/real-chrome.ts";
import type { BrowserTarget } from "./service.ts";
import { startService, until, type RealService } from "./testing/real-service.ts";

const suite = CHROME ? describe : describe.skip;

suite("sign-ins across browser restarts on real Chrome", () => {
  let fx: FixtureServer;
  let real: RealService;

  beforeAll(async () => {
    fx = await FixtureServer.start();
    real = await startService();
  }, hostTimeout(240_000));

  afterAll(async () => {
    await real?.close();
    await fx?.close();
  });

  const target: BrowserTarget = { session: "persist-1", key: "bot:persist-1" };
  const profile = () => real.service.profiles().find((candidate) => candidate.key === target.key)!;
  const cookies = async () => {
    const run = profile().run;
    if (!run) throw new Error("the browser is not running");
    const answer = await run.browser.connection.root.send("Storage.getCookies", {}) as { cookies: Array<{ name: string; value: string }> };
    return Object.fromEntries(answer.cookies.map((cookie) => [cookie.name, cookie.value]));
  };

  it("keeps a sign-in's cookies after a graceful stop and start", async () => {
    const url = fx.page("/signed-in", `<!doctype html><meta charset="utf-8"><title>Account</title><p>Signed in</p>`);
    expect((await real.call(target, "agent_browser_open", { url })).isError).toBeFalsy();
    await real.peek(target, `(document.cookie = "remembered=yes; max-age=31536000; path=/", document.cookie = "visit=one; path=/", document.cookie)`);
    expect(await cookies()).toMatchObject({ remembered: "yes", visit: "one" });

    await real.service.closeAll({ pictures: false });
    expect(profile().run).toBeNull();

    const status = real.text(await real.call(target, "agent_browser_status"));
    // the profile restores its last session: the tab and the session cookie come back with the persistent one
    expect(status).toContain("/signed-in");
    expect(await cookies()).toMatchObject({ remembered: "yes", visit: "one" });
  }, hostTimeout(120_000));

  it("keeps the profile after Chrome crashes: written sign-ins stay and the next call starts it again", async () => {
    const pid = profile().run?.opened.pid;
    expect(pid).toBeGreaterThan(0);
    process.kill(pid!, "SIGKILL");
    await until(() => profile().run, (run) => run === null, 15_000);

    const answer = await real.call(target, "agent_browser_status");
    expect(answer.isError).toBeFalsy();
    expect(real.text(answer)).toContain("stopped unexpectedly");
    expect(await cookies()).toMatchObject({ remembered: "yes" });
  }, hostTimeout(120_000));
});
