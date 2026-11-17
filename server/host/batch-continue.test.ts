import { describe, expect, it } from "vitest";

import { counts, startChecklist, tick, type Checklist } from "../batch-checklist.ts";
import type { RuntimeEvent } from "../contracts.ts";
import { batchNote, createBatchContinue, MAX_PAUSES_IN_A_ROW, type BatchLine } from "./batch-continue.ts";

const people = (n: number) => Array.from({ length: n }, (_, i) => `@person${i + 1}`);
const started = (threadId = "t1") => ({ type: "turn.started", threadId }) as RuntimeEvent;
const completed = (ok: boolean, stopReason: string | null = ok ? "end_turn" : "error", threadId = "t1") =>
  ({ type: "turn.completed", threadId, ok, stopReason, cost: null }) as RuntimeEvent;

function harness(options: { held?: () => boolean; botOf?: (threadId: string) => string | null } = {}) {
  let list: Checklist | null = null;
  let clock = 0;
  const notes: string[] = [];
  const lines: BatchLine[] = [];
  const timers: Array<{ run: () => void; ms: number }> = [];
  const guard = createBatchContinue({
    botOf: options.botOf ?? (() => "bot1"),
    read: () => list,
    held: options.held ?? (() => false),
    carryOn: async (_bot, _thread, note) => { notes.push(note); },
    line: (_thread, line) => lines.push(line),
    later: (run, ms) => timers.push({ run, ms }),
    now: () => clock,
  });
  const flush = () => { for (const timer of timers.splice(0)) timer.run(); };
  return {
    guard, notes, lines, timers, flush,
    set: (next: Checklist | null) => { list = next; },
    get: () => list!,
    sendNext: (n: number) => { list = tick(list!, list!.items.filter((item) => item.state === "open").slice(0, n).map((item) => item.text), "done").list; },
    advance: (ms: number) => { clock += ms; },
  };
}

describe("carrying an unfinished list on", () => {
  it("runs a 94-person DM job to the end when every turn stops after about ten sends", () => {
    const h = harness();
    h.set(startChecklist(null, { title: "DM signups", items: people(94), verb: "sent" }));
    for (let turn = 0; turn < 20 && counts(h.get()).open > 0; turn++) {
      h.guard.onEvent(started());
      h.sendNext(10);
      // the engine's step limit ends the turn as a failure partway through the list
      h.guard.onEvent(completed(false));
      h.flush();
    }
    expect(counts(h.get())).toMatchObject({ done: 94, open: 0 });
    expect(h.notes).toHaveLength(9);
    expect(h.lines.map((line) => line.progress)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90].map((n) => `${n} of 94 sent`));
    expect(h.notes[0]).toContain("10 of 94 sent, 84 still open");
    // the note lists only what is left: a ticked person is never offered again
    expect(h.notes[0]).not.toMatch(/@person(?:[1-9]|10);/);
    expect(h.notes[0]).toContain("Open: @person11; @person12");
  });

  it("stops when a turn closed nothing, or the person stopped it, or a sign-in is needed", () => {
    for (const end of [completed(true), completed(false, "interrupted"), completed(false, "cancelled"), completed(false, "auth_required")]) {
      const h = harness();
      h.set(startChecklist(null, { title: "DMs", items: people(5) }));
      h.guard.onEvent(started());
      if (end.type === "turn.completed" && end.stopReason !== "end_turn") h.sendNext(1);
      h.guard.onEvent(end);
      h.flush();
      expect(h.notes).toEqual([]);
    }
  });

  it("leaves a finished list, a room and a held thread alone", () => {
    const done = harness();
    done.set(tick(startChecklist(null, { title: "DMs", items: ["@a"] }), ["@a"], "done").list);
    done.guard.onEvent(started());
    done.guard.onEvent(completed(true));
    expect(done.timers).toEqual([]);
    expect(done.guard.active("t1")).toBe(false);

    const room = harness({ botOf: () => null });
    room.set(startChecklist(null, { title: "DMs", items: people(3) }));
    room.guard.onEvent(started());
    room.sendNext(1);
    room.guard.onEvent(completed(true));
    expect(room.timers).toEqual([]);

    const held = harness({ held: () => true });
    held.set(startChecklist(null, { title: "DMs", items: people(3) }));
    held.guard.onEvent(started());
    held.sendNext(1);
    held.guard.onEvent(completed(true));
    held.flush();
    expect(held.notes).toEqual([]);
  });

  it("waits out a rate-limit pause before carrying on, and gives up after too many pauses in a row", () => {
    const h = harness();
    h.set(startChecklist(null, { title: "DMs", items: people(5), verb: "sent" }));
    h.guard.onEvent(started());
    h.sendNext(2);
    h.guard.pause("t1", 15 * 60_000);
    h.guard.onEvent(completed(true));
    expect(h.lines).toEqual([{ kind: "paused", progress: "2 of 5 sent", minutes: 15 }]);
    expect(h.timers.map((timer) => timer.ms)).toEqual([15 * 60_000]);
    h.flush();
    expect(h.notes).toHaveLength(1);
    for (let i = 0; i < MAX_PAUSES_IN_A_ROW; i++) {
      h.guard.onEvent(started());
      h.guard.pause("t1", 60_000);
      h.guard.onEvent(completed(true));
      h.flush();
    }
    expect(h.notes).toHaveLength(MAX_PAUSES_IN_A_ROW);
  });

  it("a new turn the person starts during a pause cancels the pending carry-on", () => {
    const h = harness();
    h.set(startChecklist(null, { title: "DMs", items: people(5) }));
    h.guard.onEvent(started());
    h.sendNext(1);
    h.guard.onEvent(completed(false));
    h.guard.onEvent(started());
    h.flush();
    expect(h.notes).toEqual([]);
  });

  it("tells the bot its list's remaining items and that the carry-on adds no new approval", () => {
    const note = batchNote(tick(startChecklist(null, { title: "DMs", items: people(50), verb: "sent" }), ["@person1"], "done").list);
    expect(note).toContain("adds no approval for anything else");
    expect(note).toContain("and 9 more");
  });
});
