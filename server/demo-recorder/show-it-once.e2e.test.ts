// Show it once in a real Chrome on the CDP driver: a person holding the browser files one expense with real mouse and
// key events, and the saved recording files the other eleven. Runs where the driver's own suites run (DUSK_CDP_CHROME,
// or DUSK_CDP_E2E=1 for the installed Google Chrome).
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { demoStepSentence } from "../../shared/demo-recording.ts";
import { CHROME } from "../browser/cdp/testing/real-chrome.ts";
import type { CdpPage } from "../browser/cdp/page.ts";
import type { BrowserTarget } from "../browser/service.ts";
import { startService, type RealService } from "../browser/testing/real-service.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { replayBatch } from "./batch.ts";
import { DemoCapture } from "./capture.ts";
import { compileDemo } from "./compile.ts";
import { readInputFolder } from "./inputs.ts";
import { normaliseDemo } from "./normalise.ts";
import { demoPortOf } from "./ports.ts";
import { DEMO_REFERENCE_PATH, parseDemoReference, renderDemoSkill } from "./skill-file.ts";
import { ExpensePortal } from "./testing/expense-portal.ts";
import { EXPENSES, INBOX, filedAs, receiptPath, shownSentences, withoutId } from "./testing/scenario.ts";
import { testVault } from "./testing/vault.ts";

const suite = CHROME ? describe : describe.skip;
const PERSON = "person-ada";
const SECRET = "Quartz-Zebra!42&real";

suite("Show it once in a real browser", () => {
  let real: RealService;
  let portal: ExpensePortal;
  const target: BrowserTarget = { session: "bot-show-it-once", key: "bot-show-it-once" };

  beforeAll(async () => {
    portal = await ExpensePortal.start({ password: SECRET });
    real = await startService();
  }, hostTimeout(240_000));

  afterAll(async () => {
    await real?.close();
    await portal?.close();
  }, hostTimeout(60_000));

  const page = (): CdpPage => real.service.profile(target).active()!.page;
  const port = () => demoPortOf(real.service.loginDeps(target), real.service.demoExtras(target));

  /** The address the tab shows, once it is `path`: a click that leaves the page is followed there before the person acts again. */
  async function arrive(path: string): Promise<void> {
    await page().waitFor({ urlIncludes: path, timeoutMs: 15_000 });
    await page().waitFor({ load: "load", timeoutMs: 15_000 });
  }

  it("records one expense from a person's real clicks and typing, and replays the other eleven", async () => {
    const opened = await real.call(target, "agent_browser_open", { url: "about:blank" });
    expect(opened.isError, real.text(opened)).toBeFalsy();
    const profile = real.service.profile(target);
    await profile.control.take(PERSON);
    expect(real.service.heldBy(target.session)).toBe(PERSON);

    const capture = new DemoCapture(port(), { pollMs: 150 });
    await capture.start();
    const expense = EXPENSES[0]!;

    await page().navigate(portal.url("/login"));
    await page().type({ selector: "[name=uid]" }, "ada.lovelase");
    await page().fill({ selector: "[name=uid]" }, "");
    await page().type({ selector: "[name=uid]" }, portal.user);
    await page().type({ selector: "[name=pw]" }, SECRET);
    await page().click({ selector: "input[type=submit]" });
    await arrive("/expenses");
    await page().click({ x: 700, y: 500 });
    await page().scroll(null, 0, 300);
    await page().click({ selector: '#nav a[href="/expenses/new"]' });
    await arrive("/expenses/new");
    await page().type({ selector: "[name=date]" }, expense.date);
    await page().type({ selector: "[name=merchant]" }, "Blue Bottel");
    await page().fill({ selector: "[name=merchant]" }, "");
    await page().type({ selector: "[name=merchant]" }, expense.merchant);
    await page().select({ selector: "[name=category]" }, ["Travel"]);
    await page().select({ selector: "[name=category]" }, [expense.category]);
    await page().click({ selector: "[name=amount]" });
    await page().click({ selector: "[name=date]" });
    await page().type({ selector: "[name=amount]" }, expense.amount);
    await page().press("Tab");
    await page().click({ selector: "[name=paid][value=personal]" });
    await page().click({ selector: "[name=paid][value=corp]" });
    await page().click({ selector: "[name=billable]" });
    await page().click({ selector: "[name=billable]" });
    await page().click({ selector: "label[for$=_bl]" });
    await page().type({ selector: "[name=notes]" }, expense.notes);
    await page().upload([receiptPath(expense)], { selector: "[name=receipt]" });
    await page().click({ selector: "input[type=submit]" });
    await arrive("/expenses/review");
    await page().click({ selector: "button[type=submit]" });
    await arrive("/expenses/done");

    const events = await capture.stop();
    await profile.control.release(PERSON, async () => true);
    expect(real.service.heldBy(target.session)).toBeNull();
    expect(portal.filed.map(withoutId)).toEqual([filedAs(expense)]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(events)).not.toContain(SECRET.slice(0, 8));

    const steps = normaliseDemo(events);
    expect(steps.map(demoStepSentence)).toEqual(shownSentences(portal, expense));
    const compiled = await compileDemo(steps, { title: "File an expense report", keep: new Map([[steps.find((step) => step.kind === "check")!.id, "billable"]]) });
    const skill = renderDemoSkill(compiled.recording);
    const recording = parseDemoReference(skill.files.find((file) => file.path === DEMO_REFERENCE_PATH)!.content)!;
    expect(recording).toEqual(compiled.recording);

    portal.signOutAll();
    const vault = testVault(real.service.loginDeps(target), portal);
    const { records } = readInputFolder(INBOX, recording.blanks, { except: ["expense-01.json"] });
    const outcome = await replayBatch(port(), recording, records, { signIn: vault.signIn, resolveFile: (value, record) => join(record.folder ?? "", value) });
    expect(outcome.text).toContain("11");
    expect(outcome.items.filter((item) => !item.ok).map((item) => item.text)).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(portal.filed.map(withoutId)).toEqual(EXPENSES.map(filedAs));
    expect(vault.asked).toEqual(["127.0.0.1"]);
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  }, hostTimeout(300_000));

  it("stops at the step a redesigned page no longer has, and leaves the page for the bot's own tools", async () => {
    const compiled = await compileDemo([
      { id: "s1", kind: "open", url: portal.url("/expenses/new") },
      { id: "s2", kind: "fill", target: { role: "textbox", name: "", label: "Merchant" }, value: "Lyft" },
      { id: "s3", kind: "click", target: { role: "button", name: "Continue" } },
    ], { title: "Start a report" });
    portal.redesigned = true;
    const outcome = await replayBatch(port(), compiled.recording, [{ source: "one.json", values: { merchant: "Souvla" } }], { stepTimeoutMs: 1_500 });
    portal.redesigned = false;
    expect(outcome.ok).toBe(false);
    expect(outcome.items[0]!.outcome).toMatchObject({ done: ["s1", "s2"], remaining: ['Click the "Continue" button.'] });
    const merchant = await real.read<string>(target, "document.querySelector('[name=merchant]').value");
    expect(merchant).toBe("Souvla");
    const clicked = await real.call(target, "agent_browser_click", { selector: "input[type=submit]" });
    expect(clicked.isError, real.text(clicked)).toBeFalsy();
  }, hostTimeout(120_000));
});
