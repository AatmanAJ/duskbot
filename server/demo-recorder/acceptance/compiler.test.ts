import { describe, expect, it } from "vitest";

import { blankNames, fillBlanks, fixBlank, matchesPattern, moveStep, removeStep, renameBlank, updateStep, validatePlan, BLANK_NAME } from "../../../shared/demo-plan.ts";
import type { DemoEvent, DemoPlan, DemoTarget, DemoTrace } from "../../../shared/demo-recording.ts";
import { parseSkillMd } from "../../../shared/skill-md.ts";
import { compileDemo, compilePrompt, outlineDemo, type DemoEngine } from "../compiler.ts";
import { demoRoutinePrompt, renderDemoSkill } from "../skill.ts";

const URL = "http://127.0.0.1:4173/portal.html?signedIn=1";
const LIST = { title: "Expenses · Harbor Expenses", url: URL };
const FORM = { title: "New expense · Harbor Expenses", url: URL };
const field = (name: string): DemoTarget => ({ role: "textbox", name, secure: false, bounds: { x: 20, y: 200, width: 400, height: 28 } });
const NEW: DemoTarget = { role: "button", name: "New expense", secure: false };
const SUBMIT: DemoTarget = { role: "button", name: "Submit expense", secure: false };
const CATEGORY: DemoTarget = { role: "combobox", name: "Category", secure: false, choices: ["Meals", "Travel", "Software", "Office supplies", "Other"] };

function trace(events: Array<Omit<DemoEvent, "seq" | "at">>, more: Partial<DemoTrace> = {}): DemoTrace {
  return {
    surface: "browser",
    accessibility: "dom",
    durationMs: events.length * 1_500,
    events: events.map((event, index) => ({ seq: index + 1, at: index * 1_500, before: `f${index}`, after: `f${index + 1}`, ...event })),
    frames: events.map((_, index) => ({ id: `f${index}`, width: 1280, height: 800, type: "image/png" as const, masked: false })),
    framesSkipped: 0,
    truncated: false,
    ...more,
  };
}

/** One expense shown on the portal: the events a recording of it holds. */
function expenseTrace(): DemoTrace {
  return trace([
    { kind: "click", target: NEW, point: { x: 700, y: 120 }, context: LIST, appeared: ["New expense"] },
    { kind: "click", target: field("Merchant"), point: { x: 200, y: 214 }, context: FORM },
    { kind: "type", target: field("Merchant"), text: "Blue Door Coffee", context: FORM },
    { kind: "key", key: "Tab", context: FORM },
    { kind: "type", target: field("Amount"), text: "18.40", context: FORM },
    { kind: "click", target: field("Date"), point: { x: 200, y: 300 }, context: FORM },
    { kind: "type", target: field("Date"), text: "2026-11-02", context: FORM },
    { kind: "scroll", direction: "down", point: { x: 300, y: 400 }, context: FORM },
    { kind: "choose", target: CATEGORY, text: "Meals", context: FORM },
    { kind: "type", target: field("Notes"), text: "Team stand-up coffee", context: FORM },
    { kind: "click", target: SUBMIT, point: { x: 760, y: 560 }, context: FORM, appeared: ["Expenses", "Expense EXP-1001 submitted: Blue Door Coffee, $18.40"] },
  ]);
}

const texts = (plan: DemoPlan) => JSON.stringify(plan.steps.map((step) => [step.goal, step.actions, step.check]));

function scripted(answer: string | (() => Promise<string>)): DemoEngine & { prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, generateText: async (prompt) => { prompts.push(prompt); return typeof answer === "string" ? answer : answer(); } };
}

describe("the steps written from a recording alone", () => {
  it("names a blank for everything the person typed or chose", () => {
    const plan = outlineDemo(expenseTrace());

    expect(plan.compiledBy).toBe("outline");
    expect(plan.blanks.map((blank) => [blank.name, blank.label, blank.kind, blank.example])).toEqual([
      ["merchant", "Merchant", "text", "Blue Door Coffee"],
      ["amount", "Amount", "number", "18.40"],
      ["date", "Date", "date", "2026-11-02"],
      ["category", "Category", "choice", "Meals"],
      ["notes", "Notes", "text", "Team stand-up coffee"],
    ]);
    expect(plan.blanks[3]!.choices).toEqual(CATEGORY.choices);
    for (const blank of plan.blanks) expect(blank.name).toMatch(BLANK_NAME);
  });

  it("begins by opening the page the person began on", () => {
    const plan = outlineDemo(expenseTrace());

    expect(plan.steps[0]!.actions).toEqual([{ do: "open", url: URL }]);
    expect(plan.steps[0]!.check.kind).toBe("url");
  });

  it("writes each step as a goal found by role and name, with the blank in place of what was typed", () => {
    const plan = outlineDemo(expenseTrace());
    const actions = plan.steps.flatMap((step) => step.actions);

    expect(actions).toEqual([
      { do: "open", url: URL },
      { do: "click", role: "button", name: "New expense" },
      { do: "fill", role: "textbox", name: "Merchant", value: "{{merchant}}" },
      { do: "fill", role: "textbox", name: "Amount", value: "{{amount}}" },
      { do: "fill", role: "textbox", name: "Date", value: "{{date}}" },
      { do: "choose", role: "combobox", name: "Category", value: "{{category}}" },
      { do: "fill", role: "textbox", name: "Notes", value: "{{notes}}" },
      { do: "click", role: "button", name: "Submit expense" },
    ]);
    for (const example of ["Blue Door Coffee", "18.40", "2026-11-02", "Team stand-up coffee"]) expect(texts(plan)).not.toContain(example);
    const amount = plan.steps.find((step) => step.actions.some((action) => action.do === "fill" && action.name === "Amount"))!;
    expect(amount.goal).toContain("{{amount}}");
    expect(amount.goal).toContain("Amount");
    expect(amount.title.length).toBeGreaterThan(0);
  });

  it("gives every step a check, drawn from what the screen showed next", () => {
    const plan = outlineDemo(expenseTrace());

    for (const step of plan.steps) expect(step.check, step.title).toBeTruthy();
    const fill = plan.steps.find((step) => step.actions.some((action) => action.do === "fill" && action.name === "Amount"))!;
    expect(fill.check).toEqual({ kind: "field", role: "textbox", name: "Amount", value: "{{amount}}" });
    const open = plan.steps.find((step) => step.actions.some((action) => action.do === "click" && action.name === "New expense"))!;
    expect(open.check).toEqual({ kind: "text", text: "New expense" });
    const submit = plan.steps.at(-1)!;
    expect(submit.check.kind).toBe("text");
    const pattern = (submit.check as { text: string }).text;
    expect(pattern).toContain("{{merchant}}");
    expect(pattern).toContain("{{amount}}");
    expect(pattern).not.toMatch(/1001|Blue Door/);
    expect(matchesPattern(fillBlanks(pattern, { merchant: "Lumen Rail", amount: "64.00" }), "Expense EXP-1007 submitted: Lumen Rail, $64.00")).toBe(true);
    expect(matchesPattern(fillBlanks(pattern, { merchant: "Lumen Rail", amount: "64.00" }), "Expense EXP-1007 submitted: Marlow Cabs, $41.30")).toBe(false);
  });

  it("points each step at its picture and the events it came from", () => {
    const outline = outlineDemo(expenseTrace());
    const merchant = outline.steps.find((step) => step.actions.some((action) => action.do === "fill" && action.name === "Merchant"))!;

    expect(merchant.events).toEqual([2, 3]);
    expect(merchant.frame).toBeTruthy();
    expect(new Set(outline.steps.map((step) => step.id)).size).toBe(outline.steps.length);
    expect(outline.title.length).toBeGreaterThan(0);
    expect(outline.title.length).toBeLessThanOrEqual(80);
  });

  it("makes a secret blank of a secure field, with no example", () => {
    const plan = outlineDemo(trace([
      { kind: "type", target: field("Work email"), text: "sam@harbor.test", context: { title: "Sign in", url: URL } },
      { kind: "type", target: { ...field("Password"), secure: true }, secure: true, chars: 16, context: { title: "Sign in", url: URL } },
      { kind: "click", target: { role: "button", name: "Sign in", secure: false }, context: { title: "Sign in", url: URL }, appeared: ["Expenses"] },
    ]));

    const secret = plan.blanks.find((blank) => blank.kind === "secret")!;
    expect(secret).toMatchObject({ name: "password", label: "Password" });
    expect(secret.example).toBeUndefined();
    const step = plan.steps.find((each) => each.actions.some((action) => action.do === "fill" && action.name === "Password"))!;
    expect(step.actions).toEqual([{ do: "fill", role: "textbox", name: "Password", value: "{{password}}" }]);
    expect(step.goal).toMatch(/saved sign-in/i);
  });

  it("keeps two fields with one label apart", () => {
    const plan = outlineDemo(trace([
      { kind: "type", target: field("Amount"), text: "18.40", context: FORM },
      { kind: "key", key: "Tab", context: FORM },
      { kind: "type", target: { ...field("Amount"), bounds: { x: 20, y: 400, width: 400, height: 28 } }, text: "2.10", context: FORM },
    ]));

    expect(plan.blanks.map((blank) => blank.name)).toEqual(["amount", "amount_2"]);
  });

  it("keeps Enter as a step and leaves out Tab and scrolling", () => {
    const plan = outlineDemo(trace([
      { kind: "type", target: field("Search"), text: "invoice", context: LIST },
      { kind: "key", key: "Tab", context: LIST },
      { kind: "scroll", direction: "down", context: LIST },
      { kind: "key", key: "Enter", context: LIST, appeared: ["3 results"] },
    ]));

    const actions = plan.steps.flatMap((step) => step.actions).filter((action) => action.do !== "open");
    expect(actions).toEqual([{ do: "fill", role: "textbox", name: "Search", value: "{{search}}" }, { do: "press", key: "Enter" }]);
    expect(plan.steps.at(-1)!.check).toEqual({ kind: "text", text: "* results" });
  });

  it("falls back to pictures and positions when there was no accessibility", () => {
    const plan = outlineDemo(trace([
      { kind: "click", point: { x: 412, y: 300 } },
      { kind: "type", secure: true, chars: 16 },
      { kind: "click", point: { x: 640, y: 520 } },
    ], { surface: "computer", accessibility: "none" }));

    expect(plan.steps).toHaveLength(3);
    for (const step of plan.steps) {
      expect(step.check.kind).toBe("visual");
      expect(step.actions).toEqual([]);
      expect(step.goal.length).toBeGreaterThan(0);
      expect(step.frame).toBeTruthy();
    }
    expect(plan.steps[0]!.point).toEqual({ x: 412, y: 300 });
    expect(plan.blanks).toEqual([]);
  });
});

const ENGINE_PLAN = {
  title: "File an expense in Harbor",
  summary: "Adds one expense from a receipt to Harbor Expenses.",
  blanks: [{ name: "vendor", was: "merchant", label: "Vendor" }],
  steps: [
    { title: "Start a new expense", goal: "Open Harbor Expenses and start a new expense.", events: [1], check: { kind: "text", text: "New expense" } },
    { title: "Enter the receipt", goal: "Enter Blue Door Coffee as Merchant, {{amount}} as Amount, {{date}} as Date, pick {{category}} and add {{notes}}.", events: [2, 3, 4, 5, 6, 7, 8, 9, 10], check: { kind: "field", role: "textbox", name: "Amount", value: "{{amount}}" } },
    { title: "Submit it", goal: "Submit the expense.", events: [11], check: { kind: "text", text: "Expense * submitted: {{vendor}}" } },
  ],
};

describe("the model's pass over a recording", () => {
  it("groups the recorded actions into intent-level steps", async () => {
    const engine = scripted(`Here is the plan.\n\n\`\`\`json\n${JSON.stringify(ENGINE_PLAN, null, 2)}\n\`\`\`\n`);
    const plan = await compileDemo(expenseTrace(), { engine });

    expect(engine.prompts).toHaveLength(1);
    expect(plan.compiledBy).toBe("engine");
    expect(plan.title).toBe("File an expense in Harbor");
    expect(plan.steps.map((step) => step.title)).toEqual(["Start a new expense", "Enter the receipt", "Submit it"]);
    expect(plan.steps[0]!.actions).toEqual([{ do: "open", url: URL }, { do: "click", role: "button", name: "New expense" }]);
    expect(plan.steps[1]!.actions.map((action) => action.do)).toEqual(["fill", "fill", "fill", "choose", "fill"]);
    expect(plan.steps[2]!.actions).toEqual([{ do: "click", role: "button", name: "Submit expense" }]);
    expect(plan.steps[1]!.events).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("applies the model's better names to blanks everywhere", async () => {
    const plan = await compileDemo(expenseTrace(), { engine: scripted(JSON.stringify(ENGINE_PLAN)) });

    expect(plan.blanks.map((blank) => blank.name)).toEqual(["vendor", "amount", "date", "category", "notes"]);
    expect(plan.blanks[0]).toMatchObject({ label: "Vendor", example: "Blue Door Coffee", kind: "text" });
    expect(plan.steps[1]!.actions[0]).toEqual({ do: "fill", role: "textbox", name: "Merchant", value: "{{vendor}}" });
    expect(plan.steps[2]!.check).toEqual({ kind: "text", text: "Expense * submitted: {{vendor}}" });
  });

  it("puts the blank back where the model wrote the example", async () => {
    const plan = await compileDemo(expenseTrace(), { engine: scripted(JSON.stringify(ENGINE_PLAN)) });

    expect(plan.steps[1]!.goal).toContain("{{vendor}}");
    expect(plan.steps[1]!.goal).not.toContain("Blue Door Coffee");
  });

  it("keeps a step's own check when the model gave none that holds", async () => {
    const answer = structuredClone(ENGINE_PLAN) as { steps: Array<{ check?: unknown }> };
    delete answer.steps[0]!.check;
    answer.steps[2]!.check = { kind: "smell", text: "roses" };
    const plan = await compileDemo(expenseTrace(), { engine: scripted(JSON.stringify(answer)) });

    expect(plan.compiledBy).toBe("engine");
    expect(plan.steps[0]!.check).toEqual({ kind: "text", text: "New expense" });
    expect(plan.steps[2]!.check.kind).toBe("text");
    expect((plan.steps[2]!.check as { text: string }).text).toContain("{{vendor}}");
  });

  it("falls back to the outline when the answer is not a plan", async () => {
    for (const answer of ["I could not work this out, sorry.", "{\"steps\": \"none\"}", "```json\n{ broken\n```"]) {
      const plan = await compileDemo(expenseTrace(), { engine: scripted(answer) });
      expect(plan.compiledBy).toBe("outline");
      expect(plan.steps.flatMap((step) => step.actions)).toHaveLength(8);
    }
  });

  it("falls back to the outline when the model fails or there is none", async () => {
    const logs: string[] = [];
    const failed = await compileDemo(expenseTrace(), { engine: scripted(async () => { throw new Error("rate limited"); }), log: (line) => logs.push(line) });
    const none = await compileDemo(expenseTrace(), { engine: null });

    expect(failed.compiledBy).toBe("outline");
    expect(none.compiledBy).toBe("outline");
    expect(logs.join("\n")).toMatch(/outline/i);
  });

  it("falls back to the outline when the answer drops, repeats or reorders what the person did", async () => {
    const dropped = structuredClone(ENGINE_PLAN);
    dropped.steps[1]!.events = [2, 3, 4, 5];
    const reordered = structuredClone(ENGINE_PLAN);
    reordered.steps.reverse();
    const repeated = structuredClone(ENGINE_PLAN);
    repeated.steps[2]!.events = [10, 11];
    for (const answer of [dropped, reordered, repeated]) {
      const plan = await compileDemo(expenseTrace(), { engine: scripted(JSON.stringify(answer)) });
      expect(plan.compiledBy).toBe("outline");
    }
  });

  it("falls back to the outline when the answer names a blank that does not exist", async () => {
    const invented = structuredClone(ENGINE_PLAN);
    invented.steps[2]!.goal = "Submit the expense for {{approver}}.";
    const plan = await compileDemo(expenseTrace(), { engine: scripted(JSON.stringify(invented)) });

    expect(plan.compiledBy).toBe("outline");
  });

  it("asks with the recording as lines, and says what answer it wants", () => {
    const recorded = expenseTrace();
    const prompt = compilePrompt(recorded, outlineDemo(recorded));

    for (const piece of ["New expense", "Merchant", "Blue Door Coffee", "Submit expense", "Expense EXP-1001 submitted", "\"steps\"", "\"events\"", "{{"]) expect(prompt).toContain(piece);
    for (const event of recorded.events.filter((each) => each.kind !== "scroll" && each.key !== "Tab")) expect(prompt).toMatch(new RegExp(`(^|\\n)\\s*${event.seq}[.:)]`));
  });

  it("tells the model a secret was typed without telling it anything else", () => {
    const recorded = trace([
      { kind: "type", target: { ...field("Password"), secure: true }, secure: true, chars: 16, context: { title: "Sign in", url: URL } },
    ]);
    const prompt = compilePrompt(recorded, outlineDemo(recorded));

    expect(prompt).toMatch(/Password/);
    expect(prompt).toMatch(/not recorded|never recorded/i);
    expect(prompt).not.toMatch(/16 char/i);
  });

  it("keeps what it asks to a size a model takes", () => {
    const events: Array<Omit<DemoEvent, "seq" | "at">> = [];
    for (let i = 0; i < 400; i++) events.push({ kind: "type", target: field(`Field ${i}`), text: "x".repeat(400), context: FORM, appeared: ["y".repeat(600)] });
    const recorded = trace(events);

    expect(compilePrompt(recorded, outlineDemo(recorded)).length).toBeLessThan(120_000);
  });
});

describe("editing a plan", () => {
  const plan = () => outlineDemo(expenseTrace());

  it("reads the blanks out of text and fills them in", () => {
    expect(blankNames("Enter {{merchant}} and {{ amount }}, then {{merchant}} again")).toEqual(["merchant", "amount"]);
    expect(fillBlanks("Pay {{merchant}} ${{amount}} ({{unknown}})", { merchant: "Lumen Rail", amount: "64.00" })).toBe("Pay Lumen Rail $64.00 ({{unknown}})");
  });

  it("matches a pattern loosely on case and spacing and strictly on its words", () => {
    expect(matchesPattern("Expense * submitted: Lumen Rail", "  expense EXP-1004   submitted: lumen rail, $64.00 ")).toBe(true);
    expect(matchesPattern("Expense * submitted: Lumen Rail", "Expense EXP-1004 saved: Lumen Rail")).toBe(false);
    expect(matchesPattern("$64", "Total $64.00")).toBe(true);
    expect(matchesPattern("a.b", "axb")).toBe(false);
    expect(matchesPattern("", "anything")).toBe(false);
  });

  it("renames a blank in every goal, action and check", () => {
    const renamed = renameBlank(plan(), "merchant", "vendor_name");
    if ("error" in renamed) throw new Error(renamed.error);

    expect(renamed.blanks[0]!.name).toBe("vendor_name");
    expect(texts(renamed)).toContain("{{vendor_name}}");
    expect(texts(renamed)).not.toContain("{{merchant}}");
  });

  it("refuses a name that is taken or not a name", () => {
    expect(renameBlank(plan(), "merchant", "amount")).toHaveProperty("error");
    expect(renameBlank(plan(), "merchant", "Vendor Name")).toHaveProperty("error");
    expect(renameBlank(plan(), "nobody", "vendor")).toHaveProperty("error");
  });

  it("turns a blank into a fixed value", () => {
    const fixed = fixBlank(plan(), "category", "Meals");
    if ("error" in fixed) throw new Error(fixed.error);

    expect(fixed.blanks.map((blank) => blank.name)).toEqual(["merchant", "amount", "date", "notes"]);
    expect(fixed.steps.flatMap((step) => step.actions)).toContainEqual({ do: "choose", role: "combobox", name: "Category", value: "Meals" });
    expect(texts(fixed)).not.toContain("{{category}}");
  });

  it("moves, removes and rewrites steps", () => {
    const original = plan();
    const last = original.steps.at(-1)!;
    const moved = moveStep(original, last.id, 1);
    expect(moved.steps[1]!.id).toBe(last.id);
    expect(moved.steps).toHaveLength(original.steps.length);
    expect(original.steps.at(-1)!.id).toBe(last.id);

    const removed = removeStep(original, last.id);
    expect(removed.steps.map((step) => step.id)).not.toContain(last.id);

    const rewritten = updateStep(original, last.id, { title: "Send it in", goal: "Send the expense for {{merchant}} in.", check: { kind: "text", text: "submitted: {{merchant}}" } });
    if ("error" in rewritten) throw new Error(rewritten.error);
    expect(rewritten.steps.at(-1)).toMatchObject({ title: "Send it in", check: { kind: "text", text: "submitted: {{merchant}}" } });
    expect(updateStep(original, last.id, { goal: "Send it to {{nobody}}." })).toHaveProperty("error");
    expect(updateStep(original, last.id, { title: "  " })).toHaveProperty("error");
  });

  it("accepts a plan it wrote and refuses one that is not a plan", () => {
    const good = validatePlan(JSON.parse(JSON.stringify(plan())));
    expect(good).toHaveProperty("plan");

    const noCheck = JSON.parse(JSON.stringify(plan())) as { steps: Array<{ check?: unknown }> };
    delete noCheck.steps[1]!.check;
    expect(validatePlan(noCheck)).toHaveProperty("error");
    const strayBlank = JSON.parse(JSON.stringify(plan())) as DemoPlan;
    strayBlank.steps[1]!.goal = "Click {{nothing}}";
    expect(validatePlan(strayBlank)).toHaveProperty("error");
    const script = JSON.parse(JSON.stringify(plan())) as { steps: Array<{ actions: unknown[] }> };
    script.steps[1]!.actions = [{ do: "run", command: "rm -rf /" }];
    expect(validatePlan(script)).toHaveProperty("error");
    expect(validatePlan({ title: "x" })).toHaveProperty("error");
    expect(validatePlan(null)).toHaveProperty("error");
  });

  it("drops what a plan should not carry", () => {
    const padded = JSON.parse(JSON.stringify(plan())) as DemoPlan & { extra?: string };
    padded.extra = "left over";
    (padded.blanks[0] as { example?: string; secretValue?: string }).secretValue = "hunter2";
    const checked = validatePlan(padded);
    if ("error" in checked) throw new Error(checked.error);

    expect(JSON.stringify(checked.plan)).not.toContain("hunter2");
    expect(checked.plan).not.toHaveProperty("extra");
  });
});

describe("the skill a plan is saved as", () => {
  const signIn = () => outlineDemo(trace([
    { kind: "type", target: field("Work email"), text: "sam@harbor.test", context: { title: "Sign in · Harbor Expenses", url: URL } },
    { kind: "type", target: { ...field("Password"), secure: true }, secure: true, chars: 16, context: { title: "Sign in · Harbor Expenses", url: URL } },
    { kind: "click", target: { role: "button", name: "Sign in", secure: false }, context: { title: "Sign in · Harbor Expenses", url: URL }, appeared: ["Expenses"] },
  ]));

  it("is a SKILL.md the app can install", async () => {
    const plan = await compileDemo(expenseTrace(), { engine: scripted(JSON.stringify(ENGINE_PLAN)) });
    const skill = renderDemoSkill(plan);
    const parsed = parseSkillMd(skill.content);
    if ("error" in parsed) throw new Error(parsed.error);

    expect(parsed.name).toBe(skill.name);
    expect(skill.name).toBe("file-an-expense-in-harbor");
    expect(parsed.description.length).toBeLessThanOrEqual(1024);
    expect(parsed.description).toMatch(/expense/i);
    expect(Buffer.byteLength(skill.content)).toBeLessThan(256 * 1024);
  });

  it("lists the inputs, the steps and how each is checked", async () => {
    const plan = await compileDemo(expenseTrace(), { engine: scripted(JSON.stringify(ENGINE_PLAN)) });
    const { content } = renderDemoSkill(plan);

    for (const blank of plan.blanks) expect(content).toContain(`\`${blank.name}\``);
    for (const step of plan.steps) expect(content).toContain(step.title);
    expect(content.match(/Check:/g)!.length).toBe(plan.steps.length);
    expect(content).toMatch(/try the step again/i);
    expect(content).toMatch(/Blue Door Coffee/);
    expect(content).toContain("{{vendor}}");
  });

  it("takes the name it is given", () => {
    const skill = renderDemoSkill(outlineDemo(expenseTrace()), { name: "Harbor Expense!" });

    expect(skill.name).toBe("harbor-expense");
    expect(parseSkillMd(skill.content)).toMatchObject({ name: "harbor-expense" });
  });

  it("sends a secret to the saved sign-ins and never asks for it", () => {
    const { content } = renderDemoSkill(signIn());

    expect(content).toMatch(/saved sign-in/i);
    expect(content).toMatch(/never (ask|type)/i);
    expect(content).not.toMatch(/for example[^\n]*password/i);
  });

  it("writes a routine that runs the skill over a source of inputs", () => {
    const plan = outlineDemo(expenseTrace());
    const prompt = demoRoutinePrompt(plan, "file-an-expense", "the files in ~/Receipts/new");

    expect(prompt).toContain("file-an-expense");
    expect(prompt).toContain("~/Receipts/new");
    for (const blank of plan.blanks) expect(prompt).toContain(blank.name);
  });
});
