import { afterEach, describe, expect, it } from "vitest";

import type { DemoRecording } from "../../shared/demo-recording.ts";
import type { Surface } from "../../shared/wire.ts";
import { BROWSER_CONTROL_REFUSAL } from "../browser-runtime.ts";
import type { StepContext } from "../browser-steps.ts";
import { compileDemo } from "../demo-recorder/compile.ts";
import { ExpensePortal } from "../demo-recorder/testing/expense-portal.ts";
import { FakeBrowser } from "../demo-recorder/testing/fake-browser.ts";
import { EXPENSES, INBOX, filedAs, receiptPath, withoutId } from "../demo-recorder/testing/scenario.ts";
import type { FillCandidate } from "../login-fill.ts";
import type { BotRecord } from "../store.ts";
import { createSkillReplayTurn, type SkillReplayTurnDeps } from "./skill-replay-turn.ts";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

const BOT = { id: "bot-ada", name: "Ada", threadId: "thread-main", browser: true, computer: "browser" } as unknown as BotRecord;
const TURN = { botId: "bot-ada", threadId: "thread-1", generation: "g1" };
const FOLDER = INBOX.replace(/[\\/]$/u, "");
const field = (label: string) => ({ role: "textbox", name: "", label });

async function recordingFor(portal: ExpensePortal): Promise<DemoRecording> {
  return (await compileDemo([
    { id: "s1", kind: "open", url: portal.url("/login") },
    { id: "s2", kind: "sign-in", site: "127.0.0.1" },
    { id: "s3", kind: "click", target: { role: "link", name: "New expense report" } },
    { id: "s4", kind: "fill", target: { ...field("Report date"), placeholder: "MM/DD/YYYY" }, value: "11/03/2026" },
    { id: "s5", kind: "fill", target: field("Merchant"), value: "Blue Bottle Coffee" },
    { id: "s6", kind: "select", target: { role: "combobox", name: "Category" }, value: "Meals" },
    { id: "s7", kind: "fill", target: field("Amount (USD)"), value: "18.40" },
    { id: "s8", kind: "choose", target: { role: "radiogroup", name: "Paid with" }, value: "Company card" },
    { id: "s9", kind: "check", target: { role: "checkbox", name: "Billable to client" }, checked: true, blank: "billable" },
    { id: "s10", kind: "fill", target: { role: "textbox", name: "Notes" }, value: "Coffee with the Acme team" },
    { id: "s11", kind: "upload", target: { role: "file", name: "", label: "Receipt" }, value: "receipt-01.txt" },
    { id: "s12", kind: "click", target: { role: "button", name: "Continue" } },
    { id: "s13", kind: "click", target: { role: "button", name: "Submit report" } },
  ], { title: "File an expense report" })).recording;
}

async function fixture(extra: Partial<SkillReplayTurnDeps> = {}) {
  const portal = await ExpensePortal.start();
  const browser = new FakeBrowser();
  cleanup.push(() => portal.close(), () => browser.close());
  const recording = await recordingFor(portal);
  const state = { place: "browser" as Surface | null, used: [] as string[], clock: 0 };
  const login: FillCandidate = { id: "login-1", site: "127.0.0.1", hosts: ["127.0.0.1"], exactHost: true, username: portal.user, source: "settings", secrets: async () => ({ password: portal.password, totp: null }) };
  const { replayForTurn } = createSkillReplayTurn({
    place: () => state.place,
    current: (bot) => bot,
    builtInBrowserOn: () => true,
    target: async () => ({ session: "s", spec: { command: "browser", env: {} }, env: {} }),
    claim: () => true,
    inLane: (_browser, work) => work(),
    held: () => false,
    port: () => browser.port(),
    loginInput: () => browser.loginInput(),
    recording: (_bot, skill) => (skill === "file-an-expense-report" ? recording : { error: `You have no enabled skill named "${skill}".` }),
    logins: { candidates: async (_botId, host) => (host === "127.0.0.1" ? [login] : []), sitesFor: () => [], markUsed: (id) => { state.used.push(id); } },
    onePasswordTrouble: () => undefined,
    remember: () => {},
    uploadable: async (_bot, _turn, file) => (file.startsWith(FOLDER) ? file : null),
    readableFolder: (_bot, _turn, folder) => (folder.replace(/[\\/]$/u, "") === FOLDER ? FOLDER : null),
    stillActive: () => {},
    stepContext: () => ({}) as StepContext,
    ...extra,
  });
  return { portal, browser, recording, state, replay: (args: Parameters<typeof replayForTurn>[2]) => replayForTurn(BOT, TURN, args) };
}

describe("skill_replay for a turn", () => {
  it("does the other eleven from a folder, signing in once with the saved login", async () => {
    const { replay, portal, state } = await fixture();
    const answer = await replay({ skill: "file-an-expense-report", folder: INBOX, skip: ["expense-01.json"] });
    expect(answer.text).toContain("11 of 11");
    expect(answer.ok).toBe(true);
    expect(portal.filed.map(withoutId)).toEqual(EXPENSES.slice(1).map(filedAs));
    expect(state.used).toEqual(["login-1"]);
    expect(answer.text).not.toContain(portal.password);
  });

  it("runs once with the inputs it is given, by name or by the field's label, and carries on from a step", async () => {
    const { replay, portal, recording, browser } = await fixture();
    const expense = EXPENSES[4]!;
    const inputs = { report_date: expense.date, Merchant: expense.merchant, category: expense.category, "Amount (USD)": expense.amount, paid_with: expense.paidWith, billable: "no", notes: expense.notes, receipt: receiptPath(expense) };
    const answer = await replay({ skill: "file-an-expense-report", inputs });
    expect(answer).toMatchObject({ ok: true });
    expect(portal.filed.map(withoutId)).toEqual([filedAs(expense)]);

    const missing = await replay({ skill: "file-an-expense-report", inputs: { merchant: "Lyft" } });
    expect(missing.ok).toBe(false);
    expect(missing.text).toContain("`amount_usd`");
    expect(portal.filed).toHaveLength(1);

    await browser.goto(portal.url("/expenses/new"));
    await browser.person.type("[name=date]", "11/09/2026");
    await browser.person.type("[name=merchant]", "United Airlines");
    await browser.person.select("[name=category]", "Travel");
    await browser.person.type("[name=amount]", "412.60");
    await browser.person.click("[name=paid][value=corp]");
    const resumed = await replay({ skill: "file-an-expense-report", inputs: { ...inputs, receipt: receiptPath(EXPENSES[9]!) }, from_step: recording.steps[11]!.id });
    expect(resumed).toMatchObject({ ok: true });
    expect(portal.filed).toHaveLength(2);
    expect(portal.filed[1]).toMatchObject({ merchant: "United Airlines", amount: "412.60" });
  });

  it("reads input files and hands over a file only from where the conversation may", async () => {
    const { replay, portal } = await fixture();
    const outside = await replay({ skill: "file-an-expense-report", folder: "/etc" });
    expect(outside.ok).toBe(false);
    expect(outside.text).toContain("not a folder this conversation can read");
    const file = await replay({ skill: "file-an-expense-report", inputs: { report_date: "1", merchant: "m", category: "Meals", amount_usd: "1", paid_with: "Company card", billable: "no", notes: "", receipt: "/etc/hosts" } });
    expect(file.ok).toBe(false);
    expect(file.text).toContain("`receipt`");
    const relative = await replay({ skill: "file-an-expense-report", inputs: { report_date: "1", merchant: "m", category: "Meals", amount_usd: "1", paid_with: "Company card", billable: "no", notes: "", receipt: "receipts/receipt-02.txt" } });
    expect(relative.ok).toBe(false);
    const bad = await replay({ skill: "file-an-expense-report", inputs: ["not", "a", "map"] });
    expect(bad.ok).toBe(false);
    expect(portal.filed).toEqual([]);
  });

  it("says where it can run, and waits when the browser is someone else's for now", async () => {
    const elsewhere = await fixture();
    elsewhere.state.place = "local" as Surface;
    expect((await elsewhere.replay({ skill: "file-an-expense-report", folder: INBOX })).text).toContain("select_computer");
    expect((await elsewhere.replay({ skill: "nope" })).text).toContain("no enabled skill");
    expect((await elsewhere.replay({})).ok).toBe(false);
    const busy = await fixture({ claim: () => false });
    expect((await busy.replay({ skill: "file-an-expense-report", folder: INBOX })).text).toContain("Another conversation is using this browser");
    const taken = await fixture({ inLane: async () => { throw new Error(BROWSER_CONTROL_REFUSAL); } });
    const refused = await taken.replay({ skill: "file-an-expense-report", folder: INBOX });
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain("The person is using this browser right now");
    const off = await fixture({ builtInBrowserOn: () => false });
    expect((await off.replay({ skill: "file-an-expense-report", folder: INBOX })).text).toContain("built-in browser is off");
  });

  it("stops for a person who takes the browser, says what it filed, and can be told to do only the rest", async () => {
    let filedWhenTaken = Infinity;
    const { replay, portal } = await fixture({
      held: () => portal.filed.length >= filedWhenTaken,
      // As the browser's own gate answers: the action ran, and the person has the browser by the time it ends.
      inLane: async (_browser, work) => {
        await work();
        if (portal.filed.length >= filedWhenTaken) throw new Error(BROWSER_CONTROL_REFUSAL);
        throw new Error("the run was expected to be interrupted");
      },
    });
    filedWhenTaken = 2;
    const answer = await replay({ skill: "file-an-expense-report", folder: INBOX, skip: ["expense-01.json"] });
    expect(answer.ok).toBe(false);
    expect(portal.filed.map(withoutId)).toEqual(EXPENSES.slice(1, 3).map(filedAs));
    expect(answer.text).toContain("for 2 of 11 records: expense-02.json, expense-03.json");
    expect(answer.text).toContain("The person took the browser, so the run stopped here.");
    expect(answer.text).toContain('skip ["expense-02.json","expense-03.json","expense-04.txt"]');

    const rest = await fixture();
    const after = await rest.replay({ skill: "file-an-expense-report", folder: INBOX, skip: ["expense-01.json", "expense-02.json", "expense-03.json"] });
    expect(after.text).toContain("9 of 9");
    expect(rest.portal.filed.map(withoutId)).toEqual(EXPENSES.slice(3).map(filedAs));
  });

  it("answers within its time, naming the files it did not get to", async () => {
    let clock = 0;
    const { replay, portal } = await fixture({ now: () => (clock += 1_000), budgetMs: 2_500 });
    const answer = await replay({ skill: "file-an-expense-report", folder: INBOX, skip: ["expense-01.json"] });
    expect(answer.ok).toBe(false);
    expect(portal.filed.length).toBeGreaterThanOrEqual(1);
    expect(portal.filed.length).toBeLessThan(11);
    expect(answer.text).toContain("Not started:");
    expect(answer.text).toContain("expense-12.json");
    expect(answer.text).not.toContain("Stopped at step");
  });

  it("stops the run, without an answer of its own, once the turn has ended", async () => {
    let calls = 0;
    const { replay, portal } = await fixture({ stillActive: () => { if (++calls > 6) throw new Error("the turn ended"); } });
    await expect(replay({ skill: "file-an-expense-report", folder: INBOX, skip: ["expense-01.json"] })).rejects.toThrow("the turn ended");
    expect(portal.filed).toEqual([]);
  });
});
