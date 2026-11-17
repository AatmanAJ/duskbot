// The whole of Show it once on the fake expense portal: a person files one expense with control of the browser, the
// recording becomes a skill with named blanks, and the other eleven expenses of the inbox are filed from their files.
import { join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoStepSentence, type DemoDraft, type DemoRecording } from "../../shared/demo-recording.ts";
import { replayBatch } from "./batch.ts";
import { matchInputs, readInputFolder, type InputRecord } from "./inputs.ts";
import { DemoRecorder, type DemoRecorderDeps } from "./recorder.ts";
import { replayDemo, type DemoInputs } from "./replay.ts";
import { DEMO_REFERENCE_PATH, parseDemoReference, type DemoSkillFiles } from "./skill-file.ts";
import { ExpensePortal } from "./testing/expense-portal.ts";
import { FakeBrowser } from "./testing/fake-browser.ts";
import { EXPENSES, INBOX, filedAs, shownSentences, showOneExpense, withoutId } from "./testing/scenario.ts";
import { testVault } from "./testing/vault.ts";

const BOT = "bot-ada";
const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

async function startPortal(): Promise<ExpensePortal> {
  const portal = await ExpensePortal.start();
  cleanup.push(() => portal.close());
  return portal;
}

function openBrowser(scripts = true): FakeBrowser {
  const browser = new FakeBrowser({ scriptsOnNewDocuments: scripts });
  cleanup.push(() => browser.close());
  return browser;
}

interface Studio {
  recorder: DemoRecorder;
  drafts: DemoDraft[];
  saved: DemoSkillFiles[];
  routines: Array<{ name: string; prompt: string }>;
  control: { held: boolean };
}

function studio(browser: FakeBrowser, extra: Partial<DemoRecorderDeps> = {}): Studio {
  const drafts: DemoDraft[] = [];
  const saved: DemoSkillFiles[] = [];
  const routines: Array<{ name: string; prompt: string }> = [];
  const control = { held: true };
  const recorder = new DemoRecorder({
    port: async () => browser.port(),
    held: () => control.held,
    saveSkill: (_botId, skill) => { saved.push(skill); return { name: skill.name }; },
    createRoutine: (_botId, routine) => { routines.push(routine); return { id: `routine-${routines.length}` }; },
    changed: (draft) => drafts.push(structuredClone(draft)),
    pollMs: 60_000,
    ...extra,
  });
  return { recorder, drafts, saved, routines, control };
}

/** Records the first expense of the inbox and saves it as a skill, with the tick box made a blank. */
async function recordedSkill(portal: ExpensePortal, { scripts = true } = {}): Promise<{ recording: DemoRecording; skill: DemoSkillFiles }> {
  const browser = openBrowser(scripts);
  const { recorder, saved } = studio(browser);
  await recorder.start(BOT, "browser");
  await showOneExpense(browser, portal, EXPENSES[0]!, { arrived: async () => { await recorder.sync(BOT); } });
  const draft = await recorder.stop(BOT);
  const tick = draft.steps.find((step) => step.kind === "check")!;
  recorder.patchStep(BOT, tick.id, { blank: "billable" });
  await recorder.save(BOT, "skill");
  const skill = saved.at(-1)!;
  return { skill, recording: parseDemoReference(skill.files.find((file) => file.path === DEMO_REFERENCE_PATH)!.content)! };
}

/** A file a record names, kept inside the record's own folder. */
function insideFolder(value: string, record: InputRecord): string | null {
  const path = resolve(record.folder ?? "", value);
  const away = relative(record.folder ?? "", path);
  return away.startsWith("..") || away.includes(`..${sep}`) ? null : path;
}

describe.each([
  { engine: "a browser that runs the recorder in every new page", scripts: true },
  { engine: "a browser that can only be asked", scripts: false },
])("recording one expense in $engine", ({ scripts }) => {
  it("turns the person's messy demonstration into thirteen steps in words, as they happen", async () => {
    const portal = await startPortal();
    const browser = openBrowser(scripts);
    const { recorder, drafts } = studio(browser);
    expect(recorder.draft(BOT)).toMatchObject({ botId: BOT, state: "idle", steps: [] });
    const started = await recorder.start(BOT, "browser");
    expect(started).toMatchObject({ state: "recording", place: "browser" });
    await showOneExpense(browser, portal, EXPENSES[0]!, { arrived: scripts ? undefined : async () => { await recorder.sync(BOT); } });
    const draft = await recorder.sync(BOT);
    expect(portal.filed.map(withoutId)).toEqual([filedAs(EXPENSES[0]!)]);
    expect(draft.state).toBe("recording");
    expect(draft.steps.map(demoStepSentence)).toEqual(shownSentences(portal, EXPENSES[0]!));
    expect(draft.steps).toHaveLength(13);
    expect(draft.startUrl).toBe(portal.url("/login"));
    expect(drafts.length).toBeGreaterThan(1);
    expect(drafts.map((seen) => seen.revision)).toEqual(drafts.map((seen) => seen.revision).toSorted((a, b) => a - b));
    expect(drafts.at(-1)).toEqual(draft);
  });
});

describe("the recorder", () => {
  it("records only while the person holds control, and stops when they hand it back", async () => {
    const portal = await startPortal();
    const browser = openBrowser();
    const { recorder, control } = studio(browser);
    control.held = false;
    expect(await recorder.start(BOT, "browser")).toHaveProperty("error");
    expect(recorder.draft(BOT).state).toBe("idle");
    control.held = true;
    await recorder.start(BOT, "browser");
    await browser.goto(portal.url("/login"));
    await browser.person.click("input[type=submit]");
    await recorder.released(BOT, "computer");
    expect(recorder.draft(BOT).state).toBe("recording");
    await recorder.released(BOT, "browser");
    const draft = recorder.draft(BOT);
    expect(draft.state).toBe("review");
    expect(draft.steps.map((step) => step.kind)).toEqual(["open", "click"]);
    await browser.person.click("input[type=submit]");
    expect((await recorder.sync(BOT)).steps).toHaveLength(2);
  });

  it("says why when the page cannot be read, and records nothing", async () => {
    const { recorder } = studio(openBrowser(), { port: async () => ({ refusal: "The browser is not open." }) });
    expect(await recorder.start(BOT, "browser")).toEqual({ error: "The browser is not open." });
    expect(recorder.draft(BOT).state).toBe("idle");
  });

  it("names the blanks with one AI pass when recording stops, and keeps each bot's recording apart", async () => {
    const portal = await startPortal();
    const browser = openBrowser();
    const namer = vi.fn(async (prompt: string) => JSON.stringify({ title: "File an expense report", blanks: [{ step: /"(s\d+)"[^\n]*Amount/u.exec(prompt)?.[1], name: "amount" }] }));
    const { recorder } = studio(browser, { nameBlanks: () => namer });
    await recorder.start(BOT, "browser");
    await showOneExpense(browser, portal, EXPENSES[0]!);
    const draft = await recorder.stop(BOT);
    expect(namer).toHaveBeenCalledTimes(1);
    expect(draft).toMatchObject({ state: "review", named: "ai", title: "File an expense report" });
    expect(draft.blanks.map((blank) => blank.name)).toEqual(["report_date", "merchant", "category", "amount", "paid_with", "notes", "receipt"]);
    expect(draft.steps.find((step) => step.blank === "amount")).toMatchObject({ kind: "fill", value: EXPENSES[0]!.amount });
    expect(recorder.draft("bot-other")).toMatchObject({ state: "idle", steps: [] });
  });

  it("lets the person delete a step, rename a blank, make a value fixed or a blank, and name the task", async () => {
    const portal = await startPortal();
    const browser = openBrowser();
    const { recorder, saved } = studio(browser);
    await recorder.start(BOT, "browser");
    await showOneExpense(browser, portal, EXPENSES[0]!, { wander: true });
    let draft = await recorder.stop(BOT);
    expect(draft.steps.map(demoStepSentence)).toContain('Click the "Help" link.');
    expect(draft.steps).toHaveLength(14);
    const help = draft.steps.find((step) => step.target?.name === "Help")!;
    draft = recorder.deleteStep(BOT, help.id) as DemoDraft;
    expect(draft.steps).toHaveLength(13);
    draft = recorder.renameBlank(BOT, "amount_usd", "amount") as DemoDraft;
    expect(draft.blanks.map((blank) => blank.name)).toContain("amount");
    expect(draft.steps.some((step) => step.blank === "amount_usd")).toBe(false);
    const tick = draft.steps.find((step) => step.kind === "check")!;
    draft = recorder.patchStep(BOT, tick.id, { blank: "billable" }) as DemoDraft;
    expect(draft.blanks.find((blank) => blank.name === "billable")).toMatchObject({ kind: "toggle", example: "yes" });
    const paid = draft.steps.find((step) => step.kind === "choose")!;
    draft = recorder.patchStep(BOT, paid.id, { blank: null }) as DemoDraft;
    expect(draft.blanks.map((blank) => blank.name)).not.toContain("paid_with");
    draft = recorder.patchStep(BOT, paid.id, { value: "Personal card" }) as DemoDraft;
    expect(draft.steps.find((step) => step.id === paid.id)!.value).toBe("Personal card");
    draft = recorder.setTitle(BOT, "  File an expense report  ") as DemoDraft;
    expect(draft.title).toBe("File an expense report");

    expect(recorder.renameBlank(BOT, "amount", "Not A Name")).toHaveProperty("error");
    expect(recorder.renameBlank(BOT, "amount", "merchant")).toHaveProperty("error");
    expect(recorder.renameBlank(BOT, "nope", "x")).toHaveProperty("error");
    expect(recorder.patchStep(BOT, "s-missing", { blank: "x" })).toHaveProperty("error");
    expect(recorder.patchStep(BOT, draft.steps[0]!.id, { blank: "start" })).toHaveProperty("error");
    expect(recorder.patchStep(BOT, draft.steps[1]!.id, { value: "hunter2" })).toHaveProperty("error");
    expect(recorder.deleteStep(BOT, "s-missing")).toHaveProperty("error");
    expect(recorder.setTitle(BOT, "   ")).toHaveProperty("error");

    const result = await recorder.save(BOT, "skill");
    expect(result).toEqual({ skill: "file-an-expense-report" });
    const recording = parseDemoReference(saved[0]!.files.find((file) => file.path === DEMO_REFERENCE_PATH)!.content)!;
    expect(recording.steps.map((step) => step.blank ?? null)).toEqual([null, null, null, "report_date", "merchant", "category", "amount", null, "billable", "notes", "receipt", null, null]);
    expect(recorder.draft(BOT)).toMatchObject({ state: "idle", steps: [] });
  });

  it("edits the list while it is still being recorded, and keeps those edits as more is recorded", async () => {
    const portal = await startPortal();
    const browser = openBrowser();
    const { recorder } = studio(browser);
    await recorder.start(BOT, "browser");
    await browser.goto(portal.url("/login"));
    await browser.person.type("[name=uid]", portal.user);
    await browser.person.type("[name=pw]", portal.password);
    await browser.person.click("input[type=submit]");
    await browser.person.click('#nav a[href="/help"]');
    let draft = await recorder.sync(BOT);
    expect(draft.steps.map((step) => step.kind)).toEqual(["open", "sign-in", "click"]);
    draft = recorder.deleteStep(BOT, draft.steps[2]!.id) as DemoDraft;
    expect(draft.steps).toHaveLength(2);
    await browser.person.click('#nav a[href="/expenses/new"]');
    await browser.person.type("[name=merchant]", "Lyft");
    draft = await recorder.sync(BOT);
    const merchant = draft.steps.find((step) => step.kind === "fill")!;
    draft = recorder.patchStep(BOT, merchant.id, { blank: "vendor" }) as DemoDraft;
    await browser.person.type("[name=amount]", "42.15");
    draft = await recorder.sync(BOT);
    expect(draft.steps.map((step) => [step.kind, step.blank ?? step.target?.name ?? ""])).toEqual([["open", ""], ["sign-in", ""], ["click", "New expense report"], ["fill", "vendor"], ["fill", ""]]);
    draft = await recorder.stop(BOT);
    expect(draft.steps.map((step) => step.blank ?? null)).toEqual([null, null, null, "vendor", "amount_usd"]);
  });

  it("saves nothing without steps, and throws a recording away when asked", async () => {
    const portal = await startPortal();
    const browser = openBrowser();
    const { recorder, saved } = studio(browser);
    expect(await recorder.save(BOT, "skill")).toHaveProperty("error");
    await recorder.start(BOT, "browser");
    await browser.goto(portal.url("/login"));
    await recorder.sync(BOT);
    expect(recorder.discard(BOT)).toMatchObject({ state: "idle", steps: [] });
    expect(saved).toEqual([]);
    await browser.person.click("input[type=submit]");
    expect((await recorder.sync(BOT)).steps).toEqual([]);
  });

  it("saves a routine that runs the skill over a folder, switched off until the person turns it on", async () => {
    const portal = await startPortal();
    const browser = openBrowser();
    const { recorder, saved, routines } = studio(browser);
    await recorder.start(BOT, "browser");
    await showOneExpense(browser, portal, EXPENSES[0]!);
    await recorder.stop(BOT);
    recorder.setTitle(BOT, "File an expense report");
    const result = await recorder.save(BOT, "routine", { folder: INBOX });
    expect(result).toEqual({ skill: "file-an-expense-report", routineId: "routine-1" });
    expect(saved).toHaveLength(1);
    expect(routines).toHaveLength(1);
    expect(routines[0]!.name).toBe("File an expense report");
    expect(routines[0]!.prompt).toContain("file-an-expense-report");
    expect(routines[0]!.prompt).toContain(`folder ${JSON.stringify(INBOX)}`);
    expect(routines[0]!.prompt).toContain("skill_replay");
  });

  it("reports a skill that could not be saved and keeps the recording", async () => {
    const portal = await startPortal();
    const browser = openBrowser();
    const { recorder } = studio(browser, { saveSkill: () => ({ error: "A skill with that name already exists." }) });
    await recorder.start(BOT, "browser");
    await showOneExpense(browser, portal, EXPENSES[0]!);
    await recorder.stop(BOT);
    expect(await recorder.save(BOT, "skill")).toEqual({ error: "A skill with that name already exists." });
    expect(recorder.draft(BOT)).toMatchObject({ state: "review" });
    expect(recorder.draft(BOT).steps).toHaveLength(13);
  });
});

describe("replaying the saved skill", () => {
  it("files the other eleven expenses of the inbox, each from its own file", async () => {
    const portal = await startPortal();
    const { recording } = await recordedSkill(portal);
    expect(portal.filed).toHaveLength(1);
    portal.signOutAll();

    const browser = openBrowser(false);
    const vault = testVault(browser.loginInput(), portal);
    const { records, skipped } = readInputFolder(INBOX, recording.blanks, { except: ["expense-01.json"] });
    expect(records).toHaveLength(11);
    expect(skipped.map((entry) => entry.file)).toEqual(["README.md"]);
    const outcome = await replayBatch(browser.port(), recording, records, { signIn: vault.signIn, resolveFile: insideFolder });

    expect(outcome.text).toContain("11");
    expect(outcome).toMatchObject({ ok: true, notRun: [] });
    expect(outcome.items.map((item) => [item.source, item.ok])).toEqual(records.map((record) => [record.source, true]));
    expect(portal.filed.map(withoutId)).toEqual(EXPENSES.map(filedAs));
    expect(vault.asked).toEqual(["127.0.0.1"]);
  });

  it("stops where the page no longer matches, says what is left, and carries on from there once the bot has done that step", async () => {
    const portal = await startPortal();
    const { recording } = await recordedSkill(portal);
    portal.redesigned = true;
    const browser = openBrowser(false);
    const vault = testVault(browser.loginInput(), portal);
    const [record] = readInputFolder(INBOX, recording.blanks, { except: ["expense-01.json"] }).records;
    const inputs: DemoInputs = { ...matchInputs(recording.blanks, record!).inputs, receipt: join(INBOX, "receipts", "receipt-02.txt") };

    const stopped = await replayDemo(browser.port(), recording, inputs, { signIn: vault.signIn, stepTimeoutMs: 300 });
    expect(stopped.ok).toBe(false);
    expect(stopped.stoppedAt).toMatchObject({ index: 11, step: { kind: "click", target: { role: "button", name: "Continue" } } });
    expect(stopped.stoppedAt!.url).toBe(portal.url("/expenses/new"));
    expect(stopped.done).toEqual(recording.steps.slice(0, 11).map((step) => step.id));
    expect(stopped.remaining).toEqual(['Click the "Continue" button.', 'Click the "Submit report" button.']);
    expect(stopped.text).toContain('Click the "Continue" button.');
    expect(stopped.text).toContain(recording.steps[12]!.id);
    expect(stopped.text).toMatch(/agent_browser/u);
    expect(portal.filed).toHaveLength(1);
    expect(browser.document.querySelectorAll("[data-dusk-demo]").length).toBe(0);

    await browser.port().click("input[type=submit]");
    const resumed = await replayDemo(browser.port(), recording, inputs, { signIn: vault.signIn, fromStep: recording.steps[12]!.id });
    expect(resumed).toMatchObject({ ok: true, done: [recording.steps[12]!.id], remaining: [] });
    expect(portal.filed.map(withoutId)).toEqual([filedAs(EXPENSES[0]!), filedAs(EXPENSES[1]!)]);
  });

  it("stops a batch at the first expense the page did not take, and names the ones not started", async () => {
    const portal = await startPortal();
    const { recording } = await recordedSkill(portal);
    const browser = openBrowser(false);
    const vault = testVault(browser.loginInput(), portal);
    const records = readInputFolder(INBOX, recording.blanks, { except: ["expense-01.json"] }).records.slice(0, 4);
    const port = browser.port();
    const changing = { ...port, open: async (url: string) => { if (portal.filed.length === 2) portal.redesigned = true; await port.open(url); } };
    const outcome = await replayBatch(changing, recording, records, { signIn: vault.signIn, resolveFile: insideFolder, stepTimeoutMs: 300 });
    expect(outcome.ok).toBe(false);
    expect(outcome.items.map((item) => item.ok)).toEqual([true, false]);
    expect(outcome.items[1]!.outcome?.stoppedAt?.step.target?.name).toBe("Continue");
    expect(outcome.notRun).toEqual(["expense-04.txt", "expense-05.json"]);
    expect(outcome.text).toContain("expense-03.json");
    expect(outcome.text).toContain("expense-04.txt");
    expect(portal.filed).toHaveLength(2);
  });

  it("does not touch the page for a file that leaves a value out or names a file it may not read, and goes on to the next", async () => {
    const portal = await startPortal();
    const { recording } = await recordedSkill(portal);
    const browser = openBrowser(false);
    const vault = testVault(browser.loginInput(), portal);
    const [first, second, third] = readInputFolder(INBOX, recording.blanks, { except: ["expense-01.json"] }).records;
    const { "Amount (USD)": _amount, ...noAmount } = first!.values;
    const outcome = await replayBatch(browser.port(), recording, [
      { ...first!, values: noAmount },
      { ...second!, values: { ...second!.values, Receipt: "../../../../package.json" } },
      third!,
    ], { signIn: vault.signIn, resolveFile: insideFolder });
    expect(outcome.ok).toBe(false);
    expect(outcome.items.map((item) => item.ok)).toEqual([false, false, true]);
    expect(outcome.items[0]!.text).toContain("amount_usd");
    expect(outcome.items[1]!.text).toContain("receipt");
    expect(outcome.notRun).toEqual([]);
    expect(portal.filed.map(withoutId)).toEqual([filedAs(EXPENSES[0]!), filedAs(EXPENSES[3]!)]);
  });

  it("asks for the Vault when a sign-in is needed, and stops there when no login is saved", async () => {
    const portal = await startPortal();
    const { recording } = await recordedSkill(portal);
    portal.signOutAll();
    const browser = openBrowser(false);
    const vault = testVault(browser.loginInput(), portal, { saved: false });
    const [record] = readInputFolder(INBOX, recording.blanks, { except: ["expense-01.json"] }).records;
    const outcome = await replayDemo(browser.port(), recording, matchInputs(recording.blanks, record!).inputs, { signIn: vault.signIn, resolveFile: (value) => insideFolder(value, record!) });
    expect(outcome.ok).toBe(false);
    expect(outcome.stoppedAt).toMatchObject({ index: 1, step: { kind: "sign-in" } });
    expect(outcome.text).toContain("No saved login for 127.0.0.1");
    expect(outcome.text).toContain("request_credential");
    expect(browser.typed).toEqual([]);
    expect(portal.filed).toHaveLength(1);

    const noVault = await replayDemo(browser.port(), recording, matchInputs(recording.blanks, record!).inputs, { resolveFile: (value) => insideFolder(value, record!) });
    expect(noVault.stoppedAt).toMatchObject({ step: { kind: "sign-in" } });
    expect(browser.typed).toEqual([]);
  });

  it("never types a value into a field the page keeps private, whatever the recording says", async () => {
    const portal = await startPortal();
    const browser = openBrowser(false);
    const tampered: DemoRecording = {
      v: 1, title: "Tampered", startUrl: portal.url("/login"), blanks: [{ name: "pw", label: "Password", example: "", kind: "text" }],
      steps: [
        { id: "s1", kind: "open", url: portal.url("/login") },
        { id: "s2", kind: "fill", target: { role: "textbox", name: "", label: "User ID" }, value: "ada.lovelace" },
        { id: "s3", kind: "fill", target: { role: "textbox", name: "", label: "Password" }, value: "typed-by-a-bot", blank: "pw" },
      ],
    };
    const outcome = await replayDemo(browser.port(), tampered, { pw: "typed-by-a-bot" }, { stepTimeoutMs: 300 });
    expect(outcome.ok).toBe(false);
    expect(outcome.stoppedAt).toMatchObject({ index: 2 });
    expect(browser.typed.join("")).not.toContain("typed-by-a-bot");
    expect((browser.document.querySelector("[name=pw]") as unknown as { value: string }).value).toBe("");
    expect(JSON.stringify(outcome)).not.toContain("typed-by-a-bot");
  });

  it("opens only web addresses, and stops when the turn that asked has ended", async () => {
    const portal = await startPortal();
    const browser = openBrowser(false);
    const recording: DemoRecording = { v: 1, title: "Bad start", startUrl: "file:///etc/passwd", blanks: [], steps: [{ id: "s1", kind: "open", url: "file:///etc/passwd" }] };
    const refused = await replayDemo(browser.port(), recording, {});
    expect(refused.ok).toBe(false);
    expect(browser.visited).toEqual([]);
    const { recording: good } = await recordedSkill(portal);
    const [record] = readInputFolder(INBOX, good.blanks).records;
    const ended = replayDemo(browser.port(), good, matchInputs(good.blanks, record!).inputs, { resolveFile: (value) => insideFolder(value, record!), checkpoint: () => { throw new Error("the turn ended"); } });
    await expect(ended).rejects.toThrow("the turn ended");
  });
});
