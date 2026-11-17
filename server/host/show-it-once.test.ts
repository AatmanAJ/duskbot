import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import type { DemoDraft } from "../../shared/demo-recording.ts";
import type { BoxLoginPage } from "../box-login-page.ts";
import { demoPortOf } from "../demo-recorder/ports.ts";
import { ExpensePortal } from "../demo-recorder/testing/expense-portal.ts";
import { FakeBrowser } from "../demo-recorder/testing/fake-browser.ts";
import { EXPENSES, showOneExpense } from "../demo-recorder/testing/scenario.ts";
import { listSkills, readSkillFile, removeSkill } from "../skills.ts";
import { createShowItOnce, demoRecordingOf, saveDemoSkill, type ShowItOnceDeps } from "./show-it-once.ts";

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

async function fixture(extra: Partial<ShowItOnceDeps> = {}) {
  const portal = await ExpensePortal.start();
  const browser = new FakeBrowser({ scriptsOnNewDocuments: true });
  cleanup.push(() => portal.close(), () => browser.close());
  const botId = `bot-${randomUUID().slice(0, 8)}`;
  const state = { browserHeld: true, computerHeld: false, boxClosed: 0, drafts: [] as DemoDraft[], routines: [] as Array<{ name: string; prompt: string }> };
  const box: BoxLoginPage = { input: browser.loginInput(), url: "http://127.0.0.1/", close: () => { state.boxClosed++; } };
  const host = createShowItOnce({
    browser: async () => ({ session: "session-1", spec: { command: "browser", env: {} }, env: {} }),
    browserHeld: () => state.browserHeld,
    browserPort: () => browser.port(),
    computerHeld: () => state.computerHeld,
    boxChrome: async () => "http://127.0.0.1:9222",
    openBox: async () => box,
    namer: () => null,
    saveSkill: saveDemoSkill,
    createRoutine: (_botId, routine) => { state.routines.push(routine); return { id: "routine-1" }; },
    changed: (draft) => state.drafts.push(draft),
    scrub: (text) => text,
    watchMs: 60_000,
    ...extra,
  });
  cleanup.push(() => host.discard(botId), () => { for (const skill of listSkills(botId)) removeSkill(botId, skill.name); });
  return { portal, browser, botId, state, host };
}

describe("Show it once in the app", () => {
  it("records only for the person who holds the browser, and says in a code why it cannot", async () => {
    const { host, botId, state } = await fixture();
    state.browserHeld = false;
    expect(await host.start(botId, "browser")).toMatchObject({ code: "not-held" });
    expect(await host.start(botId, "computer")).toMatchObject({ code: "not-held" });
    expect(host.draft(botId).state).toBe("idle");
    const none = await fixture({ browser: async () => null });
    expect(await none.host.start(none.botId, "browser")).toMatchObject({ code: "no-browser" });
    const noBox = await fixture({ boxChrome: async () => false });
    noBox.state.computerHeld = true;
    expect(await noBox.host.start(noBox.botId, "computer")).toMatchObject({ code: "no-page" });
    const refused = await fixture({ openBox: async () => ({ refusal: "Chromium on your computer has no page open." }) });
    refused.state.computerHeld = true;
    expect(await refused.host.start(refused.botId, "computer")).toMatchObject({ code: "no-page" });
  });

  it("stops recording by itself once the person hands the browser back, keeping the steps to review", async () => {
    const { host, botId, state, portal, browser } = await fixture();
    expect(await host.start(botId, "browser")).toMatchObject({ state: "recording", place: "browser" });
    await browser.goto(portal.url("/login"));
    await browser.person.click("input[type=submit]");
    await host.check();
    expect(host.draft(botId).state).toBe("recording");
    state.browserHeld = false;
    await host.check();
    const draft = host.draft(botId);
    expect(draft.state).toBe("review");
    expect(draft.steps.map((step) => step.kind)).toEqual(["open", "click"]);
    await browser.person.click("input[type=submit]");
    await host.check();
    expect(host.draft(botId).steps).toHaveLength(2);
    expect(state.drafts.at(-1)).toMatchObject({ state: "review" });
  });

  it("records the browser on the bot's own computer through its Chromium, and lets go of it at the hand-back", async () => {
    const { host, botId, state, portal, browser } = await fixture();
    state.computerHeld = true;
    state.browserHeld = false;
    expect(await host.start(botId, "computer")).toMatchObject({ state: "recording", place: "computer" });
    await browser.goto(portal.url("/login"));
    await host.check();
    expect(state.boxClosed).toBe(0);
    state.computerHeld = false;
    await host.check();
    expect(host.draft(botId)).toMatchObject({ state: "review", place: "computer" });
    expect(state.boxClosed).toBe(1);
  });

  it("saves the recording as an enabled skill of the bot that skill_replay can read back", async () => {
    const { host, botId, portal, browser, state } = await fixture();
    await host.start(botId, "browser");
    await showOneExpense(browser, portal, EXPENSES[0]!);
    await host.stop(botId);
    expect(host.setTitle(botId, "File an expense report")).toMatchObject({ title: "File an expense report" });
    expect(await host.save(botId, "routine", { folder: "/work/inbox" })).toEqual({ skill: "file-an-expense-report", routineId: "routine-1" });
    expect(state.routines[0]!.prompt).toContain("/work/inbox");
    expect(listSkills(botId)).toMatchObject([{ name: "file-an-expense-report", enabled: true }]);
    expect(readSkillFile(botId, "file-an-expense-report")).toContain("## Procedure");
    const recording = demoRecordingOf(botId, "file-an-expense-report");
    if ("error" in recording) throw new Error(recording.error);
    expect(recording.steps).toHaveLength(13);
    expect(recording.blanks.map((blank) => blank.name)).toEqual(["report_date", "merchant", "category", "amount_usd", "paid_with", "notes", "receipt"]);
    expect(host.draft(botId).state).toBe("idle");

    portal.signOutAll();
    await host.start(botId, "browser");
    await showOneExpense(browser, portal, EXPENSES[1]!);
    await host.stop(botId);
    host.setTitle(botId, "File an expense report");
    expect(await host.save(botId, "skill")).toMatchObject({ code: "save-failed", error: expect.stringContaining("already") });
    expect(host.draft(botId).state).toBe("review");
  });

  it("reads no recording from a skill that has none, is switched off or does not exist", async () => {
    const { botId } = await fixture();
    expect(demoRecordingOf(botId, "no-such-skill")).toMatchObject({ error: expect.stringContaining("no enabled skill") });
    expect(demoRecordingOf(botId, "../../etc")).toHaveProperty("error");
    expect(saveDemoSkill(botId, { name: "plain", files: [{ path: "SKILL.md", content: "---\nname: plain\ndescription: A plain skill.\n---\n\n# Plain\n" }] })).toEqual({ name: "plain" });
    expect(demoRecordingOf(botId, "plain")).toMatchObject({ error: expect.stringContaining("holds no recording") });
  });

  it("gives the recorder a page it can read on any engine", async () => {
    const browser = new FakeBrowser();
    cleanup.push(() => browser.close());
    const port = demoPortOf(browser.loginInput());
    expect(await port.evaluate("1 + 1")).toBe(2);
    expect(port.upload).toBeUndefined();
    expect(port.everyDocument).toBeUndefined();
  });
});
