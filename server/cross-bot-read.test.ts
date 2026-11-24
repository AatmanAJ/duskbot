import { describe, expect, it } from "vitest";

import { CROSS_READ_REFUSALS, crossReadRefusal, crossReadThreads, type CrossReadTurn } from "./cross-bot-read.ts";

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
