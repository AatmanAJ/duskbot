import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { holdRows, newTypingHold, TYPING_MIN_MS } from "./use-typing-hold";

const T = 1_700_000_000_000;
const ask: Message = { id: "ask", role: "user", kind: "text", at: T - 10_000, text: "find me a keyboard" };
const bot = (id: string, at = T + 100): Message => ({ id, role: "bot", kind: "text", at, text: `${id} words` });
const ids = (rows: readonly Message[]) => rows.map((row) => row.id);

describe("holdRows", () => {
  it("lands a bubble whose words were already on screen (the phone's streamed reply) without a typing beat", () => {
    const state = newTypingHold([ask], T);
    const result = holdRows([ask, bot("streamed")], state, { botId: "b", busy: true, now: T + 100, shownAlready: (id) => id === "streamed" });
    expect(ids(result.rows)).toEqual(["ask", "streamed"]);
    expect(result.typing).toBe(false);
  });

  it("leaves history alone: what was there when the chat opened is never held", () => {
    const old = bot("old", T - 5_000);
    const state = newTypingHold([ask, old], T);
    expect(holdRows([ask, old], state, { botId: "b", busy: true, now: T })).toMatchObject({ typing: false, wakeAt: Infinity });
  });

  it("holds a new bubble for its 500ms typing beat, then lets it land while the turn goes on", () => {
    const state = newTypingHold([ask], T);
    const rows = [ask, bot("ack")];
    expect(holdRows(rows, state, { botId: "b", busy: true, now: T + 100 })).toMatchObject({ typing: true, wakeAt: T + 100 + TYPING_MIN_MS });
    expect(ids(holdRows(rows, state, { botId: "b", busy: true, now: T + 100 }).rows)).toEqual(["ask"]);
    const landed = holdRows(rows, state, { botId: "b", busy: true, now: T + 100 + TYPING_MIN_MS });
    expect(ids(landed.rows)).toEqual(["ask", "ack"]);
    expect(landed.typing).toBe(false);
  });

  it("ends a turn with the last bubble landing as its typing beat ends, in the frame the line starts leaving", () => {
    const state = newTypingHold([ask], T);
    const rows = [ask, bot("last")];
    expect(holdRows(rows, state, { botId: "b", busy: false, now: T })).toMatchObject({ typing: true, wakeAt: T + TYPING_MIN_MS });
    const landed = holdRows(rows, state, { botId: "b", busy: false, now: T + TYPING_MIN_MS });
    expect(landed).toMatchObject({ typing: false, wakeAt: Infinity });
    expect(ids(landed.rows)).toEqual(["ask", "last"]);
  });
});
