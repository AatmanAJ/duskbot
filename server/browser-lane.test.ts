import { describe, expect, it, vi } from "vitest";
import { BrowserLanes, type LaneGaveUp } from "./browser-lane.ts";

describe("a browser's lane", () => {
  it("says which call held it and for how long when another gives up waiting", async () => {
    let clock = 1_000;
    const gaveUp = vi.fn<LaneGaveUp>();
    const lanes = new BrowserLanes(gaveUp, () => clock);
    let finish!: () => void;
    const holding = lanes.run("s", () => new Promise<string>((done) => { finish = () => done("read"); }), 10, "agent_browser_get_url");
    await Promise.resolve();
    expect(lanes.holder("s")).toEqual({ call: "agent_browser_get_url", since: 1_000 });
    clock = 41_000;
    await expect(lanes.run("s", async () => "tabs", 10, "agent_browser_tab_list")).resolves.toBeNull();
    expect(gaveUp).toHaveBeenCalledExactlyOnceWith({ session: "s", call: "agent_browser_tab_list", waitedMs: 0, holder: { call: "agent_browser_get_url", since: 1_000 } });
    finish();
    await expect(holding).resolves.toBe("read");
    expect(lanes.holder("s")).toBeNull();
    expect(lanes.held("s")).toBe(false);
  });
});

describe("the browser runtime's lane", () => {
  it("writes the holder's call and age to the trail when a call gives up", async () => {
    const { configureTrail } = await import("../electron/trail.mjs");
    const written: Array<Record<string, unknown>> = [];
    configureTrail({ src: "server", writer: { write: (event) => written.push(event), flush: async () => {}, flushSync() {}, close() {} } });
    const { BrowserRuntime } = await import("./browser-runtime.ts");
    const runtime = new BrowserRuntime({ laneWaitMs: 10 });
    const lanes = (runtime as unknown as { lanes: BrowserLanes }).lanes;
    let finish!: () => void;
    const holding = lanes.run("s", () => new Promise<void>((done) => { finish = done; }), 10, "agent_browser_get_url");
    await lanes.run("s", async () => undefined, 10, "agent_browser_tab_list");
    finish();
    await holding;
    const busy = written.find((event) => event.ev === "browser.lane.busy");
    expect(busy).toMatchObject({ call: "agent_browser_tab_list", holder: "agent_browser_get_url" });
    expect(typeof busy?.heldMs).toBe("number");
    expect(typeof busy?.waitedMs).toBe("number");
    await runtime.closeAll();
  });
});
