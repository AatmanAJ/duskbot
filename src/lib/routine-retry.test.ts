import { describe, expect, it } from "vitest";
import { routineRetryFor, routineToRun } from "./routine-retry";

const routines = [{ id: "r1", name: "Inbox check", enabled: true }, { id: "r2", name: "Provider failure example", enabled: false }];

describe("routineRetryFor", () => {
  it("runs a marked routine line's routine again", () => {
    expect(routineRetryFor({ role: "user", text: "anything", routineStart: { name: "Inbox check", routineId: "r1" } }, routines))
      .toEqual({ state: "ready", routineId: "r1", name: "Inbox check" });
  });

  it("knows an older line's routine from its prompt's header, and runs it again while it is paused, as Run now does", () => {
    const text = '[Routine "Provider failure example", do this now:]\nTrigger id: r2\nCheck the provider.';
    const retry = routineRetryFor({ role: "user", text }, routines);
    expect(retry).toEqual({ state: "paused", routineId: "r2", name: "Provider failure example" });
    expect(routineToRun(retry)).toBe("r2");
  });

  it("says a removed routine is gone, and leaves a webhook run's line without a routine to run", () => {
    expect(routineRetryFor({ role: "user", text: "x", routineStart: { name: "Old", routineId: "gone" } }, routines)).toEqual({ state: "gone", name: "Old" });
    expect(routineRetryFor({ role: "user", text: "payload", routineStart: { name: "Orders hook" } }, routines)).toEqual({ state: "event", name: "Orders hook" });
    expect(routineToRun(routineRetryFor({ role: "user", text: "x", routineStart: { name: "Old", routineId: "gone" } }, routines))).toBeNull();
    expect(routineToRun(routineRetryFor({ role: "user", text: "payload", routineStart: { name: "Orders hook" } }, routines))).toBeNull();
  });

  it("leaves a person's own line to the ordinary retry", () => {
    expect(routineRetryFor({ role: "user", text: "check the inbox" }, routines)).toBeNull();
    expect(routineRetryFor(undefined, routines)).toBeNull();
  });
});
