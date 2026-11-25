import { describe, expect, it } from "vitest";

import { CROSS_READ_REFUSALS, crossReadRefusal, crossReadTarget, crossReadThreads, type CrossReadTurn } from "./cross-bot-read.ts";

const own: CrossReadTurn = { owned: true, room: false, guest: false, depth: 0, handedOff: false, routineRun: false, outsideDriven: false, personStarted: true };
const ask = (over: Partial<Parameters<typeof crossReadRefusal>[0]> = {}, turn: Partial<CrossReadTurn> = {}) =>
  crossReadRefusal({ enabled: true, cloudHome: false, self: false, ...over, turn: { ...own, ...turn } });

describe("crossReadRefusal", () => {
  it("lets a bot with the setting on read on the person's own message in their chat", () => {
    expect(ask()).toBeNull();
  });

  it("is off unless the person turned it on", () => {
    expect(ask({ enabled: false })).toBe(CROSS_READ_REFUSALS.off);
  });

  it("never reads on dusk cloud", () => {
    expect(ask({ cloudHome: true })).toBe(CROSS_READ_REFUSALS.cloud);
  });

  it("refuses every turn the person did not start in their own chat", () => {
    for (const turn of [{ room: true }, { guest: true }, { depth: 1 }, { handedOff: true }, { routineRun: true }, { outsideDriven: true }, { personStarted: false }, { owned: false }]) {
      expect(ask({}, turn), JSON.stringify(turn)).toBe(CROSS_READ_REFUSALS.turn);
    }
  });

  it("points a bot naming itself at its own search", () => {
    expect(ask({ self: true, enabled: false })).toBe(CROSS_READ_REFUSALS.self);
  });
});

describe("crossReadThreads", () => {
  it("keeps the other bot's own chats and leaves its rooms out", () => {
    expect(crossReadThreads(["th_main", "th_room", "th_task"], new Set(["th_room"]))).toEqual(["th_main", "th_task"]);
  });
});

describe("crossReadTarget", () => {
  type Bot = { id: string; name: string; hidden?: boolean; readsOtherChats?: boolean };
  const planner: Bot = { id: "b-plan", name: "Planner", readsOtherChats: true };
  const scout: Bot = { id: "b-scout", name: "Scout" };
  const hidden: Bot = { id: "b-hid", name: "Hidden", hidden: true };
  const bots: Bot[] = [planner, scout, hidden];
  const deps = { bots, bot: (id: string) => bots.find((bot) => bot.id === id), cloudHome: false, turn: own,
    threads: () => ({ ownThreads: ["th_main", "th_room"], roomByThread: new Map([["th_room", {}]]) }) };

  it("finds a teammate by name and keeps its own chats", () => {
    expect(crossReadTarget("Scout", planner, deps)).toEqual({ bot: scout, threads: ["th_main"] });
    expect(crossReadTarget(null, planner, deps)).toBeNull();
  });

  it("refuses a bot it cannot reach, itself, an unknown name and a reader with the switch off", () => {
    expect(crossReadTarget("b-hid", planner, deps)).toMatchObject({ status: 403 });
    expect(crossReadTarget("Planner", planner, deps)).toEqual({ status: 403, error: CROSS_READ_REFUSALS.self });
    expect(crossReadTarget("Nobody", planner, deps)).toMatchObject({ status: 404 });
    expect(crossReadTarget("Scout", { ...planner, readsOtherChats: false }, deps)).toEqual({ status: 403, error: CROSS_READ_REFUSALS.off });
  });
});
