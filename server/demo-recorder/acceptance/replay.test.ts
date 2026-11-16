// A task shown once on the fake expense portal, then carried out again for other receipts: on the same page, on a page
// laid out differently, and on one whose labels changed and that puts a survey in the way.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { fillBlanks } from "../../../shared/demo-plan.ts";
import type { DemoAction, DemoPlan, DemoReplayItem, DemoReplayProgress } from "../../../shared/demo-recording.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { createDemoCapture } from "../capture.ts";
import { compileDemo, type DemoEngine } from "../compiler.ts";
import { createFrameStore } from "../frames.ts";
import { readDemoInputs } from "../inputs.ts";
import { describeCheck, runReplay, type ReplaySurface, type StepActor, type StepRequest } from "../replay.ts";
import { openPortal, portalUrl, receiptFiles, showOneExpense, type PortalLayout, type PortalPage } from "../testing/portal-page.ts";

const dirs: string[] = [];
const pages: PortalPage[] = [];
afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

async function portal(layout: PortalLayout = "standard", options: { survey?: boolean } = {}): Promise<PortalPage> {
  const page = await openPortal(layout, options);
  pages.push(page);
  return page;
}

/** Shows one expense on the standard portal and returns the plan made from the recording alone. */
async function demonstrate(): Promise<DemoPlan> {
  const page = await openPortal("standard");
  const dir = mkdtempSync(join(tmpdir(), "dusk-demo-replay-"));
  dirs.push(dir);
  const capture = createDemoCapture({ surface: "browser", probe: page.probe, screen: page.screen, frames: createFrameStore({ dir }) });
  await showOneExpense(page.person(capture));
  expect(page.expenses()).toHaveLength(1);
  const plan = await compileDemo(await capture.finish(), { engine: null });
  await page.close();
  return plan;
}

/** The same plan, pointed at another version of the page: the site changed, the task did not. */
function onLayout(plan: DemoPlan, layout: PortalLayout, survey = false): DemoPlan {
  return {
    ...plan,
    steps: plan.steps.map((step) => ({ ...step, actions: step.actions.map((action) => (action.do === "open" ? { ...action, url: portalUrl(layout, true, survey) } : action)) })),
  };
}

let plan: DemoPlan;
let items: DemoReplayItem[];
beforeAll(async () => {
  plan = await demonstrate();
  items = await readDemoInputs(receiptFiles(), plan.blanks);
});

const others = () => items.slice(1);
const noWait = async () => {};

const RENAMED: Record<string, string> = {
  "New expense": "Add expense", Merchant: "Vendor", Amount: "Total (USD)", Date: "Purchase date", Category: "Expense type", Notes: "Memo", "Submit expense": "Send for approval",
};

/** Stands in for the bot's own computer use: it looks at the page, gets a survey out of the way and knows the new labels. */
function botFor(page: PortalPage, options: { lazy?: boolean; agrees?: boolean } = {}): StepActor & { requests: StepRequest[]; confirmed: string[] } {
  const person = page.person();
  const requests: StepRequest[] = [];
  const confirmed: string[] = [];
  const renamed = page.window.eval("window.harbor.layout") === "renamed";
  const name = (action: DemoAction) => ("name" in action ? (renamed ? RENAMED[action.name] ?? action.name : action.name) : "");
  return {
    requests,
    confirmed,
    async attempt(request) {
      requests.push(request);
      if (options.lazy) return { ok: true, note: "Done." };
      if (page.window.document.querySelector(".overlay")) await person.click("Not now");
      for (const action of request.step.actions) {
        const value = "value" in action ? fillBlanks(action.value, request.item.values) : "";
        if (action.do === "click") await person.click(name(action));
        else if (action.do === "fill") {
          await person.click(name(action));
          await person.type(value);
        } else if (action.do === "choose") await person.choose(name(action), value);
      }
      return { ok: true };
    },
    async confirm(expectation) {
      confirmed.push(expectation);
      return options.agrees !== false;
    },
  };
}

describe("reading the inputs from a folder of files", () => {
  it("makes one item of each receipt, whatever its format", () => {
    expect(items).toHaveLength(12);
    expect(items.every((item) => item.missing.length === 0), JSON.stringify(items.filter((item) => item.missing.length))).toBe(true);
    expect(items.map((item) => item.label)).toEqual(receiptFiles().map((file) => file.name));
    expect(items[0]!.values).toEqual({ merchant: "Blue Door Coffee", amount: "18.40", date: "2026-11-02", category: "Meals", notes: "Team stand-up coffee" });
    expect(items[1]!.values).toMatchObject({ merchant: "Lumen Rail", amount: "64", date: "2026-11-03", category: "Travel" });
    expect(items[2]!.values).toEqual({ merchant: "Papertrail Supply", amount: "32.15", date: "2026-11-03", category: "Office supplies", notes: "Printer paper and pens" });
    expect(new Set(items.map((item) => item.id)).size).toBe(12);
  });

  it("makes one item of each row of a table", async () => {
    const csv = "Merchant,Amount,Date,Category,Notes\nMarlow Cabs,41.30,2026-11-09,Travel,\"Ride from the airport, late\"\nHarvest Bowl,22.60,2026-11-11,meals,Working dinner\n";
    const rows = await readDemoInputs([{ name: "november.csv", content: csv }], plan.blanks);

    expect(rows).toHaveLength(2);
    expect(rows[0]!.values).toEqual({ merchant: "Marlow Cabs", amount: "41.30", date: "2026-11-09", category: "Travel", notes: "Ride from the airport, late" });
    expect(rows[1]!.values.category).toBe("Meals");
    expect(rows.map((row) => row.label)).toEqual(["november.csv row 1", "november.csv row 2"]);
  });

  it("says which inputs a file does not give", async () => {
    const [item] = await readDemoInputs([{ name: "scrap.txt", content: "Amount: 9.00\nDate: 2026-11-14\n" }], plan.blanks);

    expect(item!.values).toEqual({ amount: "9.00", date: "2026-11-14" });
    expect(item!.missing).toEqual(["merchant", "category", "notes"]);
  });

  it("asks the model for what the labels do not give, and only for that", async () => {
    const prompts: string[] = [];
    const engine: DemoEngine = { generateText: async (prompt) => { prompts.push(prompt); return "```json\n{\"merchant\": \"Corner Deli\", \"category\": \"Meals\", \"notes\": \"Sandwiches\", \"amount\": \"999\"}\n```"; } };
    const [item] = await readDemoInputs([{ name: "deli.txt", content: "CORNER DELI\n2 sandwiches\nAmount: 9.00\nDate: 2026-11-14\n" }], plan.blanks, { engine });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("CORNER DELI");
    expect(item!.values).toEqual({ merchant: "Corner Deli", amount: "9.00", date: "2026-11-14", category: "Meals", notes: "Sandwiches" });
    expect(item!.missing).toEqual([]);
  });

  it("leaves an input missing when the model cannot give it", async () => {
    const engine: DemoEngine = { generateText: async () => { throw new Error("offline"); } };
    const [item] = await readDemoInputs([{ name: "scrap.txt", content: "Amount: 9.00\n" }], plan.blanks, { engine });

    expect(item!.missing).toEqual(["merchant", "date", "category", "notes"]);
  });
});

describe("doing the task again on the page it was shown on", () => {
  it("files the other eleven receipts, checking every step", async () => {
    const page = await portal();
    const progress: DemoReplayProgress[] = [];
    const report = await runReplay({ plan, items: others(), surface: page.surface, onProgress: (event) => progress.push(event), wait: noWait });

    expect(report.done, JSON.stringify(report.items.filter((item) => item.status !== "done"))).toBe(11);
    expect(report.failed).toBe(0);
    expect(page.expenses().map((expense) => [expense.merchant, expense.amount, expense.date, expense.category, expense.notes])).toEqual(
      others().map((item) => [item.values.merchant, Number(item.values.amount), item.values.date, item.values.category, item.values.notes]),
    );
    for (const item of report.items) {
      expect(item.steps).toHaveLength(plan.steps.length);
      expect(item.steps.every((step) => step.status === "done" && step.via === "direct" && step.attempts === 1)).toBe(true);
    }
    expect(progress.filter((event) => event.type === "item-done")).toHaveLength(11);
  });

  it("reports progress in order: the item, each step begun and done, the item done", async () => {
    const page = await portal();
    const progress: DemoReplayProgress[] = [];
    await runReplay({ plan, items: others().slice(0, 2), surface: page.surface, onProgress: (event) => progress.push(event), wait: noWait });

    const first = progress.filter((event) => event.item === others()[0]!.id);
    expect(first[0]).toEqual({ type: "item-start", item: others()[0]!.id, index: 0, total: 2 });
    expect(first.at(-1)).toEqual({ type: "item-done", item: others()[0]!.id, ok: true });
    const middle = first.slice(1, -1).map((event) => event.type);
    expect(middle).toEqual(plan.steps.flatMap(() => ["step-start", "step-done"]));
    expect(progress.findIndex((event) => event.item === others()[1]!.id)).toBe(first.length);
  });

  it("tries a step again when its check does not pass", async () => {
    const page = await portal();
    let swallowed = 0;
    const flaky: ReplaySurface = {
      accessibility: page.surface.accessibility,
      observe: () => page.surface.observe(),
      perform: async (action, options) => {
        if (action.do === "fill" && action.name === "Amount" && swallowed++ === 0) return { ok: true };
        return page.surface.perform(action, options);
      },
    };
    const report = await runReplay({ plan, items: others().slice(0, 1), surface: flaky, wait: noWait });

    expect(report.done).toBe(1);
    const amount = report.items[0]!.steps.find((step) => /amount/i.test(step.title))!;
    expect(amount).toMatchObject({ status: "done", attempts: 2, via: "direct" });
    expect(page.expenses()[0]!.amount).toBe(Number(others()[0]!.values.amount));
  });

  it("fails the item at the step whose check never passes, with what the screen said, and goes on to the next", async () => {
    const page = await portal();
    const wrong: DemoReplayItem = { ...others()[0]!, id: "bad-date", label: "bad date", values: { ...others()[0]!.values, date: "11/03/2026" } };
    const report = await runReplay({ plan, items: [wrong, others()[1]!], surface: page.surface, maxAttempts: 2, wait: noWait });

    expect(report.done).toBe(1);
    expect(report.failed).toBe(1);
    const failed = report.items[0]!;
    expect(failed.status).toBe("failed");
    const last = failed.steps.at(-1)!;
    expect(last).toMatchObject({ status: "failed", attempts: 2 });
    expect(last.note).toContain("Date must look like 2026-11-03.");
    expect(failed.steps.slice(0, -1).every((step) => step.status === "done")).toBe(true);
    expect(report.items[1]!.status).toBe("done");
    expect(page.expenses().map((expense) => expense.merchant)).toEqual([others()[1]!.values.merchant]);
  });

  it("does not run the steps after a failed one", async () => {
    const page = await portal();
    const broken: ReplaySurface = {
      accessibility: page.surface.accessibility,
      observe: () => page.surface.observe(),
      perform: async (action, options) => (action.do === "fill" && action.name === "Merchant" ? { ok: false, reason: "The field would not take text." } : page.surface.perform(action, options)),
    };
    const report = await runReplay({ plan, items: others().slice(0, 1), surface: broken, maxAttempts: 2, wait: noWait });

    const steps = report.items[0]!.steps;
    const failedAt = steps.findIndex((step) => step.status === "failed");
    expect(failedAt).toBeGreaterThan(0);
    expect(steps[failedAt]!.note).toContain("The field would not take text.");
    expect(steps.slice(failedAt + 1).every((step) => step.status === "not-run" && step.attempts === 0)).toBe(true);
    expect(page.expenses()).toEqual([]);
  });

  it("skips an item that lacks an input, without touching the page", async () => {
    const page = await portal();
    const incomplete: DemoReplayItem = { id: "scrap", label: "scrap.txt", values: { amount: "9.00" }, missing: ["merchant", "date", "category", "notes"] };
    const report = await runReplay({ plan, items: [incomplete], surface: page.surface, wait: noWait });

    expect(report.items[0]).toMatchObject({ status: "skipped" });
    expect(report.items[0]!.steps.every((step) => step.status === "not-run")).toBe(true);
    expect(page.expenses()).toEqual([]);
  });

  it("stops between items when it is told to", async () => {
    const page = await portal();
    const stop = new AbortController();
    const report = await runReplay({
      plan, items: others().slice(0, 3), surface: page.surface, signal: stop.signal, wait: noWait,
      onProgress: (event) => { if (event.type === "item-done") stop.abort(); },
    });

    expect(report.items.map((item) => item.status)).toEqual(["done", "skipped", "skipped"]);
    expect(page.expenses()).toHaveLength(1);
  });
});

describe("doing the task again where the screen differs", () => {
  it("still files every receipt on a page laid out differently, without the bot", async () => {
    const page = await portal("shifted");
    const report = await runReplay({ plan: onLayout(plan, "shifted"), items: others(), surface: page.surface, wait: noWait });

    expect(report.done, JSON.stringify(report.items.filter((item) => item.status !== "done"))).toBe(11);
    expect(report.items.every((item) => item.steps.every((step) => step.via === "direct"))).toBe(true);
    expect(page.expenses().map((expense) => expense.merchant)).toEqual(others().map((item) => item.values.merchant));
    expect(page.expenses().map((expense) => expense.amount)).toEqual(others().map((item) => Number(item.values.amount)));
  });

  it("hands a step to the bot when something covers the page, and says why", async () => {
    const page = await portal("standard", { survey: true });
    const bot = botFor(page);
    const report = await runReplay({ plan: onLayout(plan, "standard", true), items: others().slice(0, 1), surface: page.surface, actor: bot, wait: noWait });

    expect(report.done).toBe(1);
    expect(bot.requests).toHaveLength(1);
    expect(bot.requests[0]!.hint).toMatch(/cover|in the way/i);
    expect(bot.requests[0]!.goal).toContain("New expense");
    const vias = report.items[0]!.steps.map((step) => step.via);
    expect(vias.filter((via) => via === "bot")).toHaveLength(1);
    expect(page.expenses()).toHaveLength(1);
  });

  it("recovers through the bot when the labels were renamed, and still checks what was entered", async () => {
    const page = await portal("renamed");
    const bot = botFor(page);
    const three = others().slice(0, 3);
    const report = await runReplay({ plan: onLayout(plan, "renamed"), items: three, surface: page.surface, actor: bot, wait: noWait });

    expect(report.done, JSON.stringify(report.items.filter((item) => item.status !== "done"))).toBe(3);
    expect(page.expenses().map((expense) => [expense.merchant, expense.amount, expense.category])).toEqual(three.map((item) => [item.values.merchant, Number(item.values.amount), item.values.category]));
    const amount = bot.requests.find((request) => /amount/i.test(request.step.title))!;
    expect(amount.goal).toContain(three[0]!.values.amount);
    expect(amount.goal).not.toContain("{{");
    expect(amount.hint).toContain("Amount");
    expect(amount.check.length).toBeGreaterThan(0);
    expect(report.items[0]!.steps.some((step) => step.via === "bot")).toBe(true);
    expect(report.items[0]!.steps.at(-1)).toMatchObject({ status: "done" });
  });

  it("does not take the bot's word for it when the value is not on the screen", async () => {
    const page = await portal("renamed");
    const bot = botFor(page, { lazy: true });
    const report = await runReplay({ plan: onLayout(plan, "renamed"), items: others().slice(0, 1), surface: page.surface, actor: bot, maxAttempts: 2, wait: noWait });

    expect(report.failed).toBe(1);
    expect(page.expenses()).toEqual([]);
    const failed = report.items[0]!.steps.find((step) => step.status === "failed")!;
    expect(failed.via).toBe("bot");
    expect(failed.attempts).toBe(2);
  });

  it("fails a renamed page plainly when there is no bot to hand it to", async () => {
    const page = await portal("renamed");
    const report = await runReplay({ plan: onLayout(plan, "renamed"), items: others().slice(0, 1), surface: page.surface, maxAttempts: 2, wait: noWait });

    expect(report.failed).toBe(1);
    const failed = report.items[0]!.steps.find((step) => step.status === "failed")!;
    expect(failed.note).toMatch(/New expense/);
  });
});

describe("doing the task again with no accessibility", () => {
  const blind = (): ReplaySurface & { performed: number } => ({
    accessibility: "none",
    performed: 0,
    async perform() { this.performed++; return { ok: false, reason: "No accessibility here." }; },
    observe: async () => ({ title: "", url: "", texts: [], fields: [] }),
  });
  const pictures: DemoPlan = {
    title: "Rename the export", summary: "", compiledBy: "outline", blanks: [],
    steps: [
      { id: "s1", title: "Open the File menu", goal: "Click where the picture shows.", actions: [], check: { kind: "visual", expect: "The File menu is open." }, frame: "f1", point: { x: 40, y: 12 }, events: [1] },
      { id: "s2", title: "Choose Export", goal: "Click where the picture shows.", actions: [], check: { kind: "visual", expect: "The export window is open." }, frame: "f2", point: { x: 60, y: 140 }, events: [2] },
    ],
  };
  const one: DemoReplayItem[] = [{ id: "a", label: "a", values: {}, missing: [] }];

  it("gives every step to the bot and has it look at the result", async () => {
    const surface = blind();
    const requests: StepRequest[] = [];
    const confirmed: string[] = [];
    const actor: StepActor = { attempt: async (request) => { requests.push(request); return { ok: true }; }, confirm: async (expectation) => { confirmed.push(expectation); return true; } };
    const report = await runReplay({ plan: pictures, items: one, surface, actor, wait: noWait });

    expect(report.done).toBe(1);
    expect(surface.performed).toBe(0);
    expect(requests.map((request) => request.step.id)).toEqual(["s1", "s2"]);
    expect(confirmed).toEqual(["The File menu is open.", "The export window is open."]);
    expect(report.items[0]!.steps.every((step) => step.via === "bot")).toBe(true);
  });

  it("fails the step when the bot looks and does not see it", async () => {
    const actor: StepActor = { attempt: async () => ({ ok: true }), confirm: async () => false };
    const report = await runReplay({ plan: pictures, items: one, surface: blind(), actor, maxAttempts: 2, wait: noWait });

    expect(report.failed).toBe(1);
    expect(report.items[0]!.steps[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(report.items[0]!.steps[1]).toMatchObject({ status: "not-run" });
  });

  it("cannot run without the bot, and says so", async () => {
    const report = await runReplay({ plan: pictures, items: one, surface: blind(), wait: noWait });

    expect(report.failed).toBe(1);
    expect(report.items[0]!.steps[0]!.note).toMatch(/bot/i);
  });
});

describe("a check in words", () => {
  it("reads as a sentence with the item's values", () => {
    expect(describeCheck({ kind: "field", role: "textbox", name: "Amount", value: "{{amount}}" }, { amount: "64.00" })).toMatch(/Amount.*64\.00/);
    expect(describeCheck({ kind: "text", text: "Expense * submitted: {{merchant}}" }, { merchant: "Lumen Rail" })).toMatch(/submitted: Lumen Rail/);
    expect(describeCheck({ kind: "visual", expect: "The export window is open." }, {})).toContain("The export window is open.");
  });
});
