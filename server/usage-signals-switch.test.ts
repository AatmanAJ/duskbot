import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REAL_USE_DAYS, REAL_USE_TURNS, createUsageSignalsSwitch } from "./usage-signals-switch.ts";

describe("help improve dusk bot switch, one setting with the account's", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  const make = () => { const dir = mkdtempSync(join(tmpdir(), "usage-switch-")); dirs.push(dir); return { dir, open: () => createUsageSignalsSwitch(dir, {}) }; };

  it("keeps a change made in the app until a report carries it, across a restart", () => {
    const { open } = make(), first = open();
    expect(first.pending()).toBeNull();
    first.set({ enabled: false });
    expect(first.pending()).toBe(true);
    const again = open();
    expect(again.enabled()).toBe(false); expect(again.pending()).toBe(true);
    again.pushed(false);
    expect(again.pending()).toBe(true);
    again.pushed(true);
    expect(again.pending()).toBeNull();
    expect(open().pending()).toBeNull();
  });
  it("turns off when the account turned it off, and back on when the account turns it on again", () => {
    const { open } = make(), sw = open();
    expect(sw.fromAccount(false)).toBeNull(); expect(sw.enabled()).toBe(true);
    expect(sw.fromAccount(true)).toMatchObject({ enabled: false }); expect(sw.enabled()).toBe(false);
    expect(open().enabled()).toBe(false);
    expect(sw.pending()).toBeNull();
    expect(sw.fromAccount(true)).toBeNull();
    expect(sw.fromAccount(false)).toMatchObject({ enabled: true }); expect(sw.enabled()).toBe(true);
  });
  it("never lets an answer undo a change the account has not heard yet", () => {
    const { open } = make(), sw = open();
    sw.fromAccount(false);
    sw.set({ enabled: false });
    expect(sw.fromAccount(false)).toBeNull(); expect(sw.enabled()).toBe(false);
    sw.pushed(true);
    expect(sw.fromAccount(true)).toBeNull(); expect(sw.enabled()).toBe(false);
    // the person turns it on in the app while the account still says off: the app's change goes up and wins
    sw.set({ enabled: true });
    expect(sw.fromAccount(true)).toBeNull(); expect(sw.enabled()).toBe(true); expect(sw.pending()).toBe(false);
  });
  it("tells the account about a choice made before the account was in the loop", () => {
    const { dir, open } = make();
    createUsageSignalsSwitch(dir, {}).set({ enabled: false });
    const file = join(dir, "usage-signals.json"), saved = JSON.parse(readFileSync(file, "utf8"));
    delete saved.push;
    writeFileSync(file, JSON.stringify(saved));
    const sw = open();
    expect(sw.pending()).toBeNull();
    expect(sw.fromAccount(false)).toBeNull();
    expect(sw.pending()).toBe(true); expect(sw.enabled()).toBe(false);
  });
  it("records and sends nothing until the workspace belongs to an account, while the switch still reads on", () => {
    const { dir, open } = make(), sw = open();
    expect(sw.choice()).toMatchObject({ enabled: true });
    expect(sw.enabled()).toBe(false);
    expect(open().enabled()).toBe(false);
    sw.fromAccount(false);
    expect(sw.enabled()).toBe(true);
    expect(open().enabled()).toBe(true);
    const file = join(dir, "usage-signals.json"), legacy = JSON.parse(readFileSync(file, "utf8"));
    delete legacy.account;
    writeFileSync(file, JSON.stringify(legacy));
    expect(open().enabled()).toBe(true);
  });
});

describe("session notes, asked for on their own", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
  const make = (onOff?: (what: "usage" | "notes") => void) => { const dir = mkdtempSync(join(tmpdir(), "usage-notes-")); dirs.push(dir); return () => createUsageSignalsSwitch(dir, {}, onOff); };
  const use = (sw: ReturnType<ReturnType<typeof make>>, turns: number, days: number) => {
    for (let i = 0; i < turns; i++) sw.used("turn", Date.UTC(2026, 10, 1 + (i % days)));
  };

  it("writes no notes without a yes, and none while usage counts are off", () => {
    const sw = make()();
    sw.fromAccount({ optOut: false, notes: false, notesAnswered: false });
    expect(sw.enabled()).toBe(true); expect(sw.notesEnabled()).toBe(false);
    sw.set({ notes: true });
    expect(sw.notesEnabled()).toBe(true); expect(sw.notesPending()).toBe(true);
    sw.set({ enabled: false });
    expect(sw.notesEnabled()).toBe(false);
  });
  it("follows the account's notes, keeps its own answer until a report carries it, and survives a restart", () => {
    const open = make(), sw = open();
    sw.fromAccount({ optOut: false, notes: true, notesAnswered: false });
    expect(sw.notesEnabled()).toBe(true);
    sw.set({ notes: false });
    expect(sw.fromAccount({ optOut: false, notes: true, notesAnswered: false })).toBeNull();
    expect(sw.notesEnabled()).toBe(false);
    sw.pushed(false, false);
    expect(sw.notesPending()).toBeNull();
    expect(open().choice()).toMatchObject({ notes: false });
  });
  it("asks once, only after real use, and never someone who answered or whose notes are on", () => {
    const sw = make()();
    sw.fromAccount({ optOut: false, notes: false, notesAnswered: false });
    use(sw, REAL_USE_TURNS, 1);
    expect(sw.choice().askNotes).toBe(false);
    sw.used("turn", Date.UTC(2026, 10, 1 + REAL_USE_DAYS));
    expect(sw.choice().askNotes).toBe(true);
    sw.set({ notes: false });
    expect(sw.choice().askNotes).toBe(false);

    const kept = make()();
    kept.fromAccount({ optOut: false, notes: true, notesAnswered: false });
    use(kept, 20, 3);
    expect(kept.choice().askNotes).toBe(false);

    const elsewhere = make()();
    elsewhere.fromAccount({ optOut: false, notes: false, notesAnswered: true });
    elsewhere.used("routine");
    expect(elsewhere.choice().askNotes).toBe(false);
    const routine = make()();
    routine.fromAccount({ optOut: false, notes: false, notesAnswered: false });
    routine.used("routine");
    expect(routine.choice().askNotes).toBe(true);
  });
  it("reads usage off where the account asks first, until the person answers, without counting that as their answer", () => {
    const open = make(), sw = open();
    sw.fromAccount({ optOut: true, notes: false, notesAnswered: false, askUsage: true });
    expect(sw.choice()).toMatchObject({ enabled: false, askUsage: true });
    expect(sw.setting()).toBe(true);
    expect(sw.pending()).toBeNull();
    sw.set({ enabled: true });
    expect(sw.choice()).toMatchObject({ enabled: true, askUsage: false });
    expect(sw.pending()).toBe(false);
    expect(open().choice()).toMatchObject({ enabled: true, askUsage: false });
  });
  it("says when usage or notes go off, here or from the account, so what was sent can be deleted", () => {
    const offs: string[] = [], sw = make(what => offs.push(what))();
    sw.fromAccount({ optOut: false, notes: true, notesAnswered: true });
    sw.set({ notes: false });
    sw.set({ notes: true });
    sw.pushed(false, true);
    sw.fromAccount({ optOut: false, notes: false, notesAnswered: true });
    sw.fromAccount({ optOut: false, notes: true, notesAnswered: true });
    sw.fromAccount({ optOut: true, notes: true, notesAnswered: true });
    expect(offs).toEqual(["notes", "notes", "usage"]);
  });
});
