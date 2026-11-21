import { describe, expect, it } from "vitest";
import type { BotReport } from "../../../../shared/dashboard-protocol.ts";
import type { BotRow } from "./usage.ts";
import type { UsageSource } from "./usage-math.ts";
import { homeStats } from "./week.ts";

const now = new Date(2026, 10, 17, 15).getTime();

const day = (date: string, turns: number) => ({ date, turns, tokens: turns * 100, costUsd: null });
const source = (id: string, days: ReturnType<typeof day>[]): UsageSource => ({
  workspaceId: id, workspaceName: id, bots: [],
  activity: { from: "2026-11-01", to: "2026-11-17", timeZone: "UTC", days, byBot: [], byModel: [], totals: { turns: 0, tokens: 0, costUsd: null } },
});
const bot = (id: string, routines: Array<{ paused: boolean }>, mood: BotRow["mood"] = "idle"): BotRow => ({
  bot: { id, name: id, color: "blue", body: null, model: null, engine: null, computer: null, busy: false, lastActiveAt: null, routines: routines.map((r, i) => ({ id: `${id}-${i}`, name: "r", schedule: "daily", nextRunAt: null, lastRunAt: null, ...r })) } as BotReport,
  where: "mac", workspaceId: "mac", kind: "mac", mood,
});

describe("homeStats", () => {
  it("is all zero for a new account, with seven empty days ending today", () => {
    const s = homeStats([], [], null, now);
    expect(s).toMatchObject({ turns: 0, bots: 0, working: 0, routines: 0, pausedRoutines: 0, apps: 0 });
    expect(s.days.map((d) => d.key)).toEqual(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]);
    expect(s.days.map((d) => d.today)).toEqual([false, false, false, false, false, false, true]);
    expect(s.days[6]!.label).toBe("tue");
    expect(s.days.every((d) => d.turns === 0)).toBe(true);
  });

  it("sums turns across workspaces for the last seven days only", () => {
    const s = homeStats([source("a", [day("2026-11-10", 50), day("2026-11-11", 3), day("2026-11-17", 4)]), source("b", [day("2026-11-17", 6)])], [], null, now);
    expect(s.days[0]!.turns).toBe(3);
    expect(s.days[6]!.turns).toBe(10);
    expect(s.turns).toBe(13);
  });

  it("counts bots, working bots, routines and distinct connected apps", () => {
    const s = homeStats([], [bot("a", [{ paused: false }, { paused: true }], "working"), bot("b", [{ paused: false }])], { mac: ["gmail", "Slack"], cloud: ["slack", "github"] }, now);
    expect(s).toMatchObject({ bots: 2, working: 1, routines: 3, pausedRoutines: 1, apps: 3 });
  });
});
