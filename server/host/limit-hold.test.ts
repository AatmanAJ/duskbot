import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { Checklist } from "../batch-checklist.ts";
import type { RuntimeEvent } from "../contracts.ts";
import { AFTER_RESET_MS, AFTER_START_MS, createLimitHold, MAX_HOLD_MS, MAX_RESUMES, resumeNote, UNKNOWN_RESET_RECHECK_MS, type HeldTurn } from "./limit-hold.ts";

const START = Date.parse("2026-11-17T10:00:00Z");
const HOUR = 3_600_000;
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A fake clock whose timers fire only when the test moves time past them. */
function fakeTime() {
  let now = START;
  let seq = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    after: (ms: number, run: () => void) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, run });
      return { cancel: () => timers.delete(id) };
    },
    pending: () => [...timers.values()].map((timer) => timer.at - now).sort((a, b) => a - b),
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].run();
        for (let i = 0; i < 10; i++) await Promise.resolve();
      }
      now = until;
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  };
}

function harness(options: { file?: string; time?: ReturnType<typeof fakeTime>; blocked?: Map<string, number | null>; resets?: Map<string, number | null> } = {}) {
  const time = options.time ?? fakeTime();
  const blocked = options.blocked ?? new Map<string, number | null>();
  const resets = options.resets ?? new Map<string, number | null>();
  const lines: Array<{ threadId: string; text: string; quiet?: boolean }> = [];
  const resumed: Array<{ turn: HeldTurn; note: string }> = [];
  const ended: string[] = [];
  let engine: string | undefined = "claude";
  let busy = false;
  let refreshes = 0;
  let list: Checklist | null = null;
  let resumeFails = false;
  const hold = createLimitHold({
    file: options.file,
    now: time.now,
    after: time.after,
    blockedUntil: (id) => { const until = blocked.get(id) ?? null; return until !== null && until > time.now() ? until : null; },
    resetAt: (id) => resets.get(id) ?? null,
    refreshUsage: async () => { refreshes += 1; },
    threadEngine: () => engine,
    busy: () => busy,
    checklist: () => list,
    resume: async (turn, note) => { if (resumeFails) throw new Error("engine would not start"); resumed.push({ turn: { ...turn }, note }); },
    line: (threadId, text, style) => lines.push({ threadId, text, ...(style === "quiet" ? { quiet: true } : {}) }),
    waitEnded: (threadId) => ended.push(threadId),
    timeZone: () => "UTC",
  });
  hold.start();
  return {
    hold, time, lines, resumed, blocked, resets, ended,
    refreshes: () => refreshes,
    setEngine: (id: string | undefined) => { engine = id; },
    setBusy: (value: boolean) => { busy = value; },
    setList: (value: Checklist | null) => { list = value; },
    failResume: () => { resumeFails = true; },
  };
}

const completed = (threadId: string, ok: boolean): RuntimeEvent =>
  ({ type: "turn.completed", threadId, ok, provider: "claudeAgent", createdAt: new Date(START).toISOString() }) as RuntimeEvent;

describe("holding a turn at a usage limit", () => {
  it("says until when it is paused, and carries on 30 s after a known reset on the same engine", async () => {
    const h = harness();
    const reset = START + 2 * HOUR;
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: reset, request: "Email the 40 leads" });
    expect(h.lines).toEqual([{ threadId: "t1", text: "Paused until 12:00 PM, your Claude limit resets then." }]);
    expect(h.time.pending()).toEqual([2 * HOUR + AFTER_RESET_MS]);
    await h.time.advance(2 * HOUR + AFTER_RESET_MS - 1);
    expect(h.resumed).toHaveLength(0);
    await h.time.advance(1);
    expect(h.resumed).toHaveLength(1);
    expect(h.resumed[0]!.turn).toMatchObject({ botId: "kai", threadId: "t1", engine: "claude", resumes: 1 });
    expect(h.ended).toEqual(["t1"]);
    expect(h.resumed[0]!.note).toContain('The person\'s request was: "Email the 40 leads"');
    expect(h.lines.at(-1)).toEqual({ threadId: "t1", text: "Your Claude limit has reset, continuing where it stopped.", quiet: true });
    h.hold.onEvent(completed("t1", true));
    expect(h.hold.list()).toEqual([]);
  });

  it("carries the open checklist into the resumed turn", async () => {
    const h = harness();
    h.setList({ title: "Leads", verb: "sent", items: [{ text: "Ana", state: "done" }, { text: "Ben", state: "open" }] });
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    await h.time.advance(HOUR + AFTER_RESET_MS);
    expect(h.resumed[0]!.note).toContain('your checklist "Leads" is not finished');
    expect(h.resumed[0]!.note).toContain("Open: Ben");
  });

  it("without a reset time, rechecks usage every 15 minutes and carries on once the engine is free", async () => {
    const h = harness();
    h.blocked.set("claude", START + HOUR);
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude" });
    expect(h.lines[0]!.text).toBe("Paused: your Claude limit is reached. Checking every 15 minutes and continuing once it resets.");
    await h.time.advance(UNKNOWN_RESET_RECHECK_MS);
    expect(h.refreshes()).toBe(1);
    expect(h.resumed).toHaveLength(0);
    expect(h.time.pending()).toEqual([UNKNOWN_RESET_RECHECK_MS]);
    await h.time.advance(UNKNOWN_RESET_RECHECK_MS * 2);
    expect(h.refreshes()).toBe(3);
    await h.time.advance(UNKNOWN_RESET_RECHECK_MS);
    expect(h.refreshes()).toBe(4);
    expect(h.resumed).toHaveLength(1);
  });

  it("learns the reset from usage on a recheck and says it once", async () => {
    const h = harness();
    h.blocked.set("claude", START + 3 * HOUR);
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude" });
    h.resets.set("claude", START + 3 * HOUR);
    await h.time.advance(UNKNOWN_RESET_RECHECK_MS);
    expect(h.lines.map((line) => line.text)).toEqual([
      "Paused: your Claude limit is reached. Checking every 15 minutes and continuing once it resets.",
      "Paused until 1:00 PM, your Claude limit resets then.",
    ]);
    expect(h.time.pending()).toEqual([3 * HOUR + AFTER_RESET_MS - UNKNOWN_RESET_RECHECK_MS]);
  });

  it("survives a restart: the saved turn is armed again and resumes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dusk-limit-hold-"));
    dirs.push(dir);
    const file = join(dir, "held.json");
    const time = fakeTime();
    const first = harness({ file, time });
    first.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR, request: "Finish the report" });
    first.hold.stop();
    expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(1);

    const second = harness({ file, time });
    expect(second.hold.held("t1")).toMatchObject({ engine: "claude", resetsAt: START + HOUR, request: "Finish the report" });
    await time.advance(HOUR + AFTER_RESET_MS);
    expect(second.resumed).toHaveLength(1);
  });

  it("a wait that fell due while the app was closed starts a little after the app does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dusk-limit-hold-"));
    dirs.push(dir);
    const file = join(dir, "held.json");
    const time = fakeTime();
    harness({ file, time }).hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    await time.advance(5 * HOUR);
    const after = harness({ file, time: fakeTimeAt(time.now()) });
    expect(after.time.pending()).toEqual([AFTER_START_MS]);
  });

  it("Stop ends the wait and says so; nothing resumes", async () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    expect(h.hold.cancel("t1", "stop")).toBe(true);
    expect(h.lines.at(-1)!.text).toBe("Stopped waiting for the limit to reset.");
    expect(h.ended).toEqual(["t1"]);
    await h.time.advance(2 * HOUR);
    expect(h.resumed).toHaveLength(0);
    expect(h.time.pending()).toEqual([]);
    expect(h.hold.cancel("t1", "stop")).toBe(false);
  });

  it("a new message from the person ends the wait quietly", () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    h.hold.cancel("t1", "superseded");
    expect(h.lines).toHaveLength(1);
    expect(h.hold.list()).toEqual([]);
  });

  it("drops the wait when the conversation moved to another AI", async () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    h.setEngine("codex");
    await h.time.advance(HOUR + AFTER_RESET_MS);
    expect(h.resumed).toHaveLength(0);
    expect(h.hold.list()).toEqual([]);
  });

  it("waits for a busy conversation before carrying on", async () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    h.setBusy(true);
    await h.time.advance(HOUR + AFTER_RESET_MS);
    expect(h.resumed).toHaveLength(0);
    h.setBusy(false);
    await h.time.advance(60_000);
    expect(h.resumed).toHaveLength(1);
  });

  it("a resume that cannot start says so and stops waiting", async () => {
    const h = harness();
    h.failResume();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    await h.time.advance(HOUR + AFTER_RESET_MS);
    expect(h.lines.at(-1)!.text).toBe("Could not continue after the limit reset. Send your message again.");
    expect(h.hold.list()).toEqual([]);
  });

  it("arms a wait longer than setTimeout allows in steps", async () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + 30 * 24 * HOUR });
    expect(h.time.pending()[0]).toBeLessThan(2 ** 31);
    await h.time.advance(25 * 24 * HOUR);
    expect(h.resumed).toHaveLength(0);
    expect(h.time.pending()).toHaveLength(1);
  });
});

describe("never looping", () => {
  it("backs off and tells the person when the resumed turn is refused again, then gives up after MAX_RESUMES", async () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    const waits: number[] = [];
    for (let resume = 1; resume <= MAX_RESUMES; resume++) {
      await h.time.advance(h.time.pending().at(-1)!);
      expect(h.resumed).toHaveLength(resume);
      h.hold.onEvent(completed("t1", false));
      const again = h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude" });
      if (resume < MAX_RESUMES) {
        expect(again).not.toBeNull();
        expect(h.lines.at(-1)!.text).toMatch(/^Claude still refused after its reset, so this tries again at /);
        waits.push(h.time.pending().at(-1)!);
      } else {
        expect(again).toBeNull();
        expect(h.lines.at(-1)!.text).toBe("Claude is still at its limit, so this stopped waiting. Send a message to try again.");
      }
    }
    expect(waits).toEqual([UNKNOWN_RESET_RECHECK_MS, 2 * UNKNOWN_RESET_RECHECK_MS]);
    await h.time.advance(10 * 24 * HOUR);
    expect(h.resumed).toHaveLength(MAX_RESUMES);
  });

  it("never wakes sooner than the reset the engine names when refused again", async () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    await h.time.advance(HOUR + AFTER_RESET_MS);
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: h.time.now() + 5 * HOUR });
    expect(h.time.pending()).toEqual([5 * HOUR + AFTER_RESET_MS]);
  });

  it("a resumed turn that fails for another reason ends the wait instead of holding it", async () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    await h.time.advance(HOUR + AFTER_RESET_MS);
    h.hold.onEvent(completed("t1", false));
    await h.time.advance(20_000);
    expect(h.hold.list()).toEqual([]);
  });

  it("another refusal before the reset only moves the time, with no second paused line for the same reset", () => {
    const h = harness();
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude", resetsAt: START + HOUR });
    expect(h.lines).toHaveLength(1);
    expect(h.time.pending()).toHaveLength(1);
  });

  it("gives up past the longest wait", async () => {
    const h = harness();
    h.blocked.set("claude", START + 30 * 24 * HOUR);
    h.hold.hold({ botId: "kai", threadId: "t1", engine: "claude", engineName: "Claude" });
    await h.time.advance(MAX_HOLD_MS + UNKNOWN_RESET_RECHECK_MS);
    expect(h.hold.list()).toEqual([]);
    expect(h.lines.at(-1)!.text).toBe("Claude is still at its limit, so this stopped waiting. Send a message to try again.");
    expect(h.refreshes()).toBeLessThanOrEqual(MAX_HOLD_MS / UNKNOWN_RESET_RECHECK_MS + 1);
  });
});

describe("resumeNote", () => {
  it("quotes the request without brackets, so it cannot close the note", () => {
    expect(resumeNote({ engineName: "Claude", request: "do [this] now" }, null)).toContain('"do (this) now"');
  });
});

function fakeTimeAt(at: number) {
  const time = fakeTime();
  void time.advance(at - START);
  return time;
}
