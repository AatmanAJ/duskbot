import { describe, expect, it } from "vitest";

import { applyBotPatch, applyLiveBotFrame, diffBotFrames, patchBase, sameJson, type PatchableBot } from "./live-patch.ts";

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function bot(tasks = 6): PatchableBot {
  return {
    id: "b1", rev: 3, name: "Nova", threadId: "t0", busy: false, activity: "idle", unread: false, section: "Team",
    modelSelection: { instanceId: "claude", model: "sonnet" }, skills: [{ name: "a", enabled: true }],
    tasks: Array.from({ length: tasks }, (_, i) => ({ threadId: `t${i}`, title: `Thread ${i}`, busy: false, activity: "idle", updatedAt: 1000 + i, alwaysAllow: ["Read"] })),
  };
}

/** Each change a server makes between two frames of a bot, applied to a copy. */
const CHANGES: Array<(b: any, r: () => number) => void> = [
  (b) => { b.busy = !b.busy; b.activity = b.busy ? "working" : "idle"; },
  (b, r) => { const task = b.tasks[Math.floor(r() * b.tasks.length)]; if (task) { task.busy = !task.busy; task.activity = task.busy ? "working" : "idle"; } },
  (b, r) => { const task = b.tasks[Math.floor(r() * b.tasks.length)]; if (task) task.title = `renamed ${Math.floor(r() * 1e6)}`; },
  (b, r) => { b.tasks.unshift({ threadId: `new-${Math.floor(r() * 1e9)}`, title: "New", busy: false, activity: "idle" }); },
  (b, r) => { if (b.tasks.length > 1) b.tasks.splice(Math.floor(r() * b.tasks.length), 1); },
  (b) => { b.tasks.reverse(); },
  (b) => { if (b.section) delete b.section; else b.section = "Ops"; },
  (b, r) => { b.modelSelection = { ...b.modelSelection, model: `m${Math.floor(r() * 9)}` }; },
  (b, r) => { const task = b.tasks[Math.floor(r() * b.tasks.length)]; if (task) task.pinned = task.pinned ? undefined : true; },
  (b) => { b.skills = [...b.skills, { name: "x", enabled: false }]; },
  (b) => { b.waitingForTeammates = undefined; },
  () => {},
];

describe("live bot patches", () => {
  it("rebuild exactly the whole frame protocol 1 would send, across many random changes", () => {
    let seed = 11;
    const random = () => { seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31; return seed / 2 ** 31; };
    let sent = bot();
    let held = roundTrip(sent);
    for (let step = 0; step < 2000; step++) {
      const next: any = structuredClone(sent);
      for (let n = 0; n < 1 + Math.floor(random() * 3); n++) CHANGES[Math.floor(random() * CHANGES.length)]!(next, random);
      next.rev = sent.rev! + 1;
      const patch = diffBotFrames(sent, next, sent.rev!, next.rev);
      if (!patch) {
        expect(sameJson({ ...sent, rev: 0 }, { ...next, rev: 0 })).toBe(true);
        continue;
      }
      const applied = applyBotPatch(held, roundTrip(patch));
      expect(applied).not.toBeNull();
      expect(applied).toEqual(roundTrip(next));
      held = applied!;
      sent = next;
    }
  });

  it("keeps every thread it did not change as the same object", () => {
    const before = roundTrip(bot(40));
    const after: any = structuredClone(before);
    after.rev = 4;
    after.tasks[7].busy = true;
    const patch = diffBotFrames(before, after, 3, 4)!;
    expect(patch.kind).toBe("task.patch");
    const applied = applyBotPatch(before, roundTrip(patch))!;
    applied.tasks!.forEach((task, i) => {
      if (i === 7) expect(task).not.toBe(before.tasks![i]);
      else expect(task).toBe(before.tasks![i]);
    });
  });

  it("is small: one thread going busy costs a few dozen bytes, not the bot", () => {
    const before = bot(100);
    const after: any = structuredClone(before);
    after.rev = 4; after.busy = true; after.activity = "working"; after.tasks[3].busy = true; after.tasks[3].activity = "working";
    const patch = diffBotFrames(before, after, 3, 4)!;
    expect(JSON.stringify(patch).length).toBeLessThan(200);
    expect(JSON.stringify(after).length).toBeGreaterThan(5000);
  });

  it("refuses a patch made from another revision, and ignores one older than what it holds", () => {
    const before = bot();
    const after: any = { ...structuredClone(before), rev: 4, name: "Renamed" };
    const patch = diffBotFrames(before, after, 3, 4)!;
    expect(applyBotPatch({ ...before, rev: 2 }, patch)).toBeNull();
    expect(applyLiveBotFrame([{ ...after }], patch as never)).toEqual([after]);
    expect(() => applyLiveBotFrame([{ ...before, rev: 1 }], patch as never)).toThrow(/does not apply/);
  });

  it("leaves a frame's page out of the bot it keeps", () => {
    expect(patchBase({ id: "b", messages: [], hasMore: false, activeLeafId: null, name: "x" })).toEqual({ id: "b", name: "x" });
  });
});
