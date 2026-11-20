import { describe, expect, it } from "vitest";
import { bareAck, MAX_STOP_GATES, openChecklist, promisesFollowUp, ranTool, schedulesWork, stopGateFor, type StopGate, type TurnSoFar } from "./turn-stop-gates.ts";

const turn = (over: Partial<TurnSoFar>): TurnSoFar => ({ reply: "", applied: new Set(), canSchedule: true, scheduled: false, effectful: 0, unconfirmed: null, ...over });

describe("promisesFollowUp", () => {
  it.each([
    "The flight is $420 today. I'll keep an eye on it and let you know if it drops.",
    "Done for now.\n\nI'll let you know when the package ships.",
    "I'll remind you tomorrow at 9.",
    "I've started a background job to rebuild the index.",
    "I'm going to check back in an hour.",
  ])("hears a promise of later work: %s", (text) => {
    expect(promisesFollowUp(text)).toBe(true);
  });

  it.each([
    "Want me to keep an eye on it?",
    "If you want, I'll remind you tomorrow.",
    "Let me know if I should check back later.",
    "The price is $420. Nothing else to do.",
    "I'll be here if you need anything.",
  ])("leaves offers and plain answers alone: %s", (text) => {
    expect(promisesFollowUp(text)).toBe(false);
  });
});

describe("openChecklist", () => {
  it("returns the open items of a checklist with work ticked off", () => {
    expect(openChecklist("Progress:\n- [x] Saved the receipt\n- [ ] Save the invoice\n- [ ] Email the summary")).toEqual(["Save the invoice", "Email the summary"]);
  });

  it("ignores a plan with nothing done, items waiting on the person, and a closing question", () => {
    expect(openChecklist("- [ ] One\n- [ ] Two")).toBeNull();
    expect(openChecklist("- [x] Drafted\n- [ ] Waiting for your approval")).toBeNull();
    expect(openChecklist("- [x] Drafted\n- [ ] Send it\n\nShall I send it?")).toBeNull();
    expect(openChecklist("- [x] All done")).toBeNull();
  });
});

describe("tool helpers", () => {
  it("knows the tools that set up later work, bridged ones included", () => {
    expect(schedulesWork("wait_until")).toBe(true);
    expect(schedulesWork("mcp__agents__background_job")).toBe(true);
    expect(schedulesWork("agents_trigger")).toBe(true);
    expect(schedulesWork("delete_trigger")).toBe(false);
    expect(schedulesWork("list_waits")).toBe(false);
    expect(ranTool("use_tool", '{"name":"wait_until","arguments":{}}')).toBe("wait_until");
    expect(ranTool("use_tool", "not json")).toBe("use_tool");
  });

  it("tells a bare ok from an answer that shows the result", () => {
    for (const text of ["ok", "OK.", "", "{}", '{"ok":true}', '{"status":"success"}', "true", "204"]) expect(bareAck(text)).toBe(true);
    for (const text of ["Stored receipt=done", '{"id":"evt_1","status":"confirmed"}', "Created event Lunch at 1pm"]) expect(bareAck(text)).toBe(false);
  });
});

describe("stopGateFor", () => {
  it("sends a promise back only when a scheduling tool is mounted and none ran", () => {
    const reply = "I'll let you know when it ships.";
    expect(stopGateFor(turn({ reply }))?.gate).toBe("follow_up");
    expect(stopGateFor(turn({ reply, canSchedule: false }))).toBeNull();
    expect(stopGateFor(turn({ reply, scheduled: true }))).toBeNull();
  });

  it("sends an open checklist back only after the turn changed something", () => {
    const reply = "- [x] Saved\n- [ ] Send the invoice";
    expect(stopGateFor(turn({ reply }))).toBeNull();
    expect(stopGateFor(turn({ reply, effectful: 1 }))).toMatchObject({ gate: "checklist", note: expect.stringContaining("Send the invoice") });
  });

  it("asks for one look at a change whose tool only said ok", () => {
    expect(stopGateFor(turn({ reply: "Updated.", unconfirmed: "calendar_update" }))).toMatchObject({ gate: "unconfirmed_write", note: expect.stringContaining("calendar_update") });
  });

  it("takes each gate once and at most MAX_STOP_GATES in a turn", () => {
    const reply = "- [x] Saved\n- [ ] Send the invoice\n\nI'll let you know when it ships.";
    const applied = new Set<StopGate>();
    const all = { reply, effectful: 1, unconfirmed: "x_write" };
    for (let index = 0; index < MAX_STOP_GATES; index++) {
      const gate = stopGateFor(turn({ ...all, applied }));
      expect(gate).not.toBeNull();
      applied.add(gate!.gate);
    }
    expect([...applied]).toEqual(["follow_up", "checklist"]);
    expect(stopGateFor(turn({ ...all, applied }))).toBeNull();
  });
});
