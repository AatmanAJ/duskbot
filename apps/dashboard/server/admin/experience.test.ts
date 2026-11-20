import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../analytics/sink.ts";
import type { UsageRecord } from "../analytics/usage.ts";
import { ABANDON_AFTER_MS, classify, experienceAnswer, itemsOf, timelineAnswer } from "./experience.ts";

const DAY = 86_400_000, T0 = Date.parse("2026-11-10T00:00:00Z");
const INSTALL = "inst_abcdefghijklmnop";
let seq = 0;
const app = (at: number, name: string, props: Record<string, string | number | boolean> = {}, install = INSTALL): StoredEvent =>
  ({ id: `e${seq++}`, name: "app_action", at, accountId: null, props: { name, ...props }, ctx: { install, app: { platform: "darwin", version: "0.2.12+dev" } } });

describe("experience admin view", () => {
  it("groups events into bad, confusing and done with plain labels", () => {
    expect(classify("turn_failed", { reason: "rate_limit" })).toEqual({ family: "bad", label: "turn failed: rate limit" });
    expect(classify("refused", { by: "request", code: "none", status: 409, route: "bots_id_messages" })).toEqual({ family: "bad", label: "request refused: none (409) at bots id messages" });
    expect(classify("refused", { by: "request", code: "none", status: 403 })?.label).toBe("request refused: none (403)");
    expect(classify("confused", { kind: "what_mean", after: "reply" })).toEqual({ family: "confusing", label: "asked what the bot meant" });
    expect(classify("routine_done", { outcome: "ok" })?.family).toBe("done");
    expect(classify("routine_done", { outcome: "failed", reason: "timeout" })).toEqual({ family: "bad", label: "routine failed: timeout" });
    expect(classify("settings_closed", { changed: false, ms: 4000 })?.family).toBe("confusing");
    expect(classify("app_screen", { screen: "/" })).toBeNull();
  });

  it("counts per day, ranks reasons, lists installs and derives abandoned first runs", () => {
    const events = [
      app(T0 + 1000, "turn_failed", { engine: "claude", reason: "rate_limit", from: "app", room: false }),
      app(T0 + 2000, "turn_failed", { engine: "claude", reason: "rate_limit", from: "app", room: false }),
      app(T0 + DAY, "turn_failed", { engine: "codex", reason: "timeout", from: "app", room: false }),
      app(T0 + DAY + 5, "confused", { kind: "rephrase", after: "reply" }),
      app(T0 + 2 * DAY, "turn_done", { engine: "claude", tools: 2, category: "email", from: "app", room: false }),
      app(T0 + 1000, "onboarding_step", { step: "ai", path: "mac" }, "inst_other_install_1"),
      { id: "x", name: "app_screen", at: T0 + 3, accountId: null, props: { screen: "/" }, ctx: { install: INSTALL } } as StoredEvent,
    ];
    const signals: UsageRecord[] = [{ id: "s1", kind: "signal", at: T0 + 3000, accountId: "acct_1", workspaceId: "cloudws1234", ran: { place: "cloud" },
      data: { id: "s1", at: T0 + 3000, name: "tool_failed", props: { tool: "browser", engine: "claude" } } }];
    const answer = experienceAnswer(itemsOf(events, signals), { from: T0, to: T0 + 3 * DAY, now: T0 + 3 * DAY });
    expect(answer.days).toEqual(["2026-11-10", "2026-11-11", "2026-11-12"]);
    expect(answer.series.bad).toEqual([3, 1, 0]);
    expect(answer.series.confusing).toEqual([1, 1, 0]);
    expect(answer.series.done).toEqual([0, 0, 1]);
    expect(answer.top.bad[0]).toEqual({ key: "turn failed: rate limit", count: 2 });
    expect(answer.top.confusing.map(row => row.key)).toContain("onboarding abandoned at ai");
    expect(answer.installs).toBe(3);
    expect(answer.recent[0]).toMatchObject({ who: INSTALL, bad: 3, confusing: 1, done: 1, version: "0.2.12+dev" });
    expect(answer.recent.find(row => row.who === "ws:cloudws1234")).toMatchObject({ bad: 1, signedIn: true });
  });

  it("does not call a first run abandoned while it may still finish, or once it did", () => {
    const events = [app(T0, "onboarding_step", { step: "ai" }), app(T0 + 10, "onboarding_step", { step: "place" }, "inst_other_install_1"), app(T0 + 20, "onboarding_completed", {}, "inst_other_install_1")];
    expect(experienceAnswer(itemsOf(events, []), { from: T0, to: T0 + DAY, now: T0 + ABANDON_AFTER_MS - 1 }).totals.confusing).toBe(0);
    expect(experienceAnswer(itemsOf(events, []), { from: T0, to: T0 + 2 * DAY, now: T0 + ABANDON_AFTER_MS }).totals.confusing).toBe(1);
  });

  it("shows one install's timeline newest first, screens included", () => {
    const events = [app(T0, "crash", { kind: "page", reason: "oom" }), { id: "s", name: "app_screen", at: T0 + 5, accountId: null, props: { screen: "/settings" }, ctx: { install: INSTALL } } as StoredEvent,
      app(T0 + 9, "created", { what: "bot" }, "inst_other_install_1")];
    const answer = timelineAnswer(itemsOf(events, []), INSTALL, T0 + DAY);
    expect(answer.items.map(item => [item.family, item.label])).toEqual([[null, "app screen (screen /settings)"], ["bad", "crash: page (oom)"]]);
  });
});
