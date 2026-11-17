// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DemoPlan, DemoRecording, DemoReplayRun } from "../../shared/demo-recording";
import { publishDemoChange } from "@/lib/demo-events";
import { DemoRecorder } from "./DemoRecorder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan = (): DemoPlan => ({
  title: "Submit expense · Harbor Expenses",
  summary: "Shown once on Harbor Expenses.",
  compiledBy: "outline",
  blanks: [
    { name: "merchant", label: "Merchant", kind: "text", example: "Blue Door Coffee" },
    { name: "amount", label: "Amount", kind: "number", example: "18.40" },
    { name: "password", label: "Password", kind: "secret" },
  ],
  steps: [
    { id: "s1", title: "Click New expense", goal: "Click the \"New expense\" button.", actions: [{ do: "click", role: "button", name: "New expense" }], check: { kind: "text", text: "New expense" }, frame: "f00000000000000000001", events: [1] },
    { id: "s2", title: "Enter Merchant", goal: "Type {{merchant}} into the \"Merchant\" field.", actions: [{ do: "fill", role: "textbox", name: "Merchant", value: "{{merchant}}" }], check: { kind: "field", role: "textbox", name: "Merchant", value: "{{merchant}}" }, events: [2] },
    { id: "s3", title: "Click Submit expense", goal: "Click the \"Submit expense\" button.", actions: [{ do: "click", role: "button", name: "Submit expense" }], check: { kind: "text", text: "Expense * submitted: {{merchant}}, ${{amount}}" }, events: [3] },
  ],
});

const recording = (more: Partial<DemoRecording> = {}): DemoRecording => ({
  id: "demo-11111111-1111-4111-8111-111111111111", botId: "bot-1", surface: "browser", accessibility: "dom", status: "ready", createdAt: 10, durationMs: 42_000, eventCount: 9,
  frames: [{ id: "f00000000000000000001", width: 1280, height: 800, type: "image/png", masked: false }], framesSkipped: 0, plan: plan(), ...more,
});

interface Call { method: string; path: string; body: unknown }
let calls: Call[];
let listed: DemoRecording[];
let answers: Record<string, (body: unknown) => unknown>;
let host: HTMLDivElement, root: Root;

beforeEach(() => {
  calls = [];
  listed = [];
  answers = {};
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ method, path, body });
    const answer = answers[`${method} ${path}`];
    const payload = answer ? answer(body) : method === "GET" && path.endsWith("/demos") ? { recordings: listed, recording: false, surfaces: { browser: true, computer: false } } : { ok: true };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

let bots = 0;
/** Each test shows its own bot a task, so one test's recordings are not another's. */
const mount = async (holding: boolean, botId = `bot-${++bots}-${Math.round(performance.now())}`, more: { onTake?: () => void; asked?: number } = {}) => {
  listed = listed.map((each) => ({ ...each, botId }));
  await act(async () => { root.render(createElement(DemoRecorder, { bot: { id: botId, name: "Nova" }, surface: "browser", holding, ...more })); });
  await act(async () => { await Promise.resolve(); });
  return botId;
};
const strip = () => host.querySelector<HTMLElement>("[data-demo-recorder]");
const button = (words: string, within: ParentNode = document.body) => [...within.querySelectorAll("button")].find((each) => each.textContent?.trim() === words);
const press = async (element: Element | undefined | null) => { expect(element, "nothing to press").toBeTruthy(); await act(async () => { (element as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };
const type = async (field: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field) as object, "value")!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const labelled = <T extends HTMLElement = HTMLInputElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`)!;
const review = () => document.querySelector<HTMLElement>("[data-demo-review]");

describe("the Record button", () => {
  it("shows only while the person holds the browser", async () => {
    await mount(false);
    expect(strip()).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(true);

    expect(button("Record", host)).toBeTruthy();
    expect(strip()!.textContent).toContain("Do the task once here. Nova keeps it as steps it can repeat.");
  });

  it("starts a recording, counts what the person does, and stops into the review", async () => {
    const botId = await mount(true);
    const live = recording({ botId, status: "recording", eventCount: 0, plan: undefined });
    answers[`POST /api/bots/${botId}/demos`] = () => ({ recording: live });
    answers[`POST /api/bots/${botId}/demos/stop`] = () => ({ recording: recording({ botId }) });
    await press(button("Record", host));

    expect(calls.at(-1)).toMatchObject({ method: "POST", path: `/api/bots/${botId}/demos`, body: { surface: "browser" } });
    expect(strip()!.dataset.demoRecorder).toBe("recording");
    expect(strip()!.textContent).toContain("Recording");
    expect(button("Stop and review", host)!.disabled).toBe(false);
    await act(async () => { publishDemoChange({ botId, recording: { ...live, eventCount: 1 } }); });
    expect(strip()!.textContent).toContain("1 action");
    await act(async () => { publishDemoChange({ botId, recording: { ...live, eventCount: 7 } }); });
    expect(strip()!.textContent).toContain("7 actions");

    await press(button("Stop and review", host));
    expect(review()).toBeTruthy();
    expect(review()!.textContent).toContain("These steps were written straight from what you showed");
    expect(document.querySelectorAll("[data-demo-step]")).toHaveLength(3);
  });

  it("takes and keeps control before it starts, so the screen stays the person's while they show the task", async () => {
    const taken: string[] = [];
    const botId = await mount(true, undefined, { onTake: () => taken.push("take") });
    answers[`POST /api/bots/${botId}/demos`] = () => ({ recording: recording({ botId, status: "recording", eventCount: 0, plan: undefined }) });
    await press(button("Record", host));

    expect(taken).toEqual(["take"]);
    expect(strip()!.dataset.demoRecorder).toBe("recording");
  });

  it("starts from the browser's menu without control: it takes control, then records once it has it", async () => {
    const taken: string[] = [];
    const onTake = () => taken.push("take");
    const botId = await mount(false, undefined, { onTake, asked: 0 });
    answers[`POST /api/bots/${botId}/demos`] = () => ({ recording: recording({ botId, status: "recording", eventCount: 0, plan: undefined }) });
    expect(strip()).toBeNull();
    await mount(false, botId, { onTake, asked: 1 });

    expect(taken).toEqual(["take"]);
    expect(button("Record", host)!.disabled).toBe(true);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    await mount(true, botId, { onTake, asked: 1 });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: `/api/bots/${botId}/demos` });
    expect(strip()!.dataset.demoRecorder).toBe("recording");
  });

  it("throws the recording away on Discard", async () => {
    const botId = await mount(true);
    answers[`POST /api/bots/${botId}/demos`] = () => ({ recording: recording({ botId, status: "recording", eventCount: 2, plan: undefined }) });
    await press(button("Record", host));
    await press(button("Discard", host));
    await act(async () => { publishDemoChange({ botId, removed: recording().id }); });

    expect(calls.at(-1)).toMatchObject({ method: "POST", path: `/api/bots/${botId}/demos/cancel` });
    expect(button("Record", host)).toBeTruthy();
  });

  it("says so when a recording could not be turned into steps", async () => {
    const botId = await mount(true);
    answers[`POST /api/bots/${botId}/demos`] = () => ({ recording: recording({ botId, status: "recording", eventCount: 1, plan: undefined }) });
    answers[`POST /api/bots/${botId}/demos/stop`] = () => ({ recording: recording({ botId, status: "failed", plan: undefined, error: "Nothing was recorded." }) });
    await press(button("Record", host));
    await press(button("Stop and review", host));

    expect(host.querySelector("[role=alert]")!.textContent).toBe("That recording could not be used. Nothing was recorded.");
    expect(review()).toBeNull();
  });
});

describe("reviewing the steps", () => {
  const opened = async (more: Partial<DemoRecording> = {}) => {
    listed = [recording(more)];
    const botId = await mount(false);
    await press(button("Shown tasks: 1", host));
    await press([...host.querySelectorAll("li button")].find((each) => each.textContent?.includes("Submit expense · Harbor Expenses")));
    expect(review()).toBeTruthy();
    return botId;
  };

  it("shows each step with its picture, goal and check", async () => {
    await opened();
    const steps = [...document.querySelectorAll<HTMLElement>("[data-demo-step]")];

    expect(steps.map((step) => step.querySelector<HTMLInputElement>("input")!.value)).toEqual(["Click New expense", "Enter Merchant", "Click Submit expense"]);
    expect(steps[0]!.querySelector<HTMLElement>("[role=img]")!.style.backgroundImage).toContain(`/api/demos/${recording().id}/frames/f00000000000000000001`);
    expect(steps[0]!.querySelector("[role=img]")!.getAttribute("aria-label")).toBe("The screen at step 1");
    expect(steps[0]!.textContent).toContain("Check: The screen shows “New expense”");
    expect(steps[1]!.textContent).toContain("Check: “Merchant” holds {{merchant}}");
    expect(steps[1]!.querySelector("[role=img]")).toBeNull();
  });

  it("renames an input in every step that uses it, and refuses a name that is taken", async () => {
    await opened();
    const rename = labelled("Rename the input merchant");
    await type(rename, "vendor");
    await act(async () => { rename.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });

    expect(document.querySelector("[data-demo-blank=vendor]")).toBeTruthy();
    expect(labelled<HTMLTextAreaElement>("Goal of step 2").value).toBe("Type {{vendor}} into the \"Merchant\" field.");
    expect(document.querySelectorAll("[data-demo-step]")[2]!.textContent).toContain("{{vendor}}");

    const again = labelled("Rename the input vendor");
    await type(again, "amount");
    await act(async () => { again.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(document.querySelector("[data-demo-blank=vendor] [role=alert]")!.textContent).toBe("Another input is already called amount.");
    expect(labelled("Rename the input vendor").value).toBe("vendor");
  });

  it("keeps an input's value the same every time, and never offers that for a secret", async () => {
    await opened();
    expect(document.querySelector("[data-demo-blank=password]")!.textContent).toContain("Filled from a saved sign-in. Never recorded.");
    expect(button("Always use this", document.querySelector("[data-demo-blank=password]")!)).toBeUndefined();
    await press(button("Always use this", document.querySelector("[data-demo-blank=merchant]")!));

    expect(document.querySelector("[data-demo-blank=merchant]")).toBeNull();
    expect(labelled<HTMLTextAreaElement>("Goal of step 2").value).toBe("Type Blue Door Coffee into the \"Merchant\" field.");
  });

  it("moves and removes steps with the buttons", async () => {
    await opened();
    const titles = () => [...document.querySelectorAll<HTMLElement>("[data-demo-step]")].map((step) => step.dataset.demoStep);
    await press(labelled<HTMLButtonElement>("Move step 3 up"));
    expect(titles()).toEqual(["s1", "s3", "s2"]);
    expect(labelled<HTMLButtonElement>("Move step 1 up").disabled).toBe(true);
    await press(labelled<HTMLButtonElement>("Remove step 1"));
    expect(titles()).toEqual(["s3", "s2"]);
  });

  it("saves the edited steps, then the skill, and says what it was saved as", async () => {
    const botId = await opened();
    const id = recording().id;
    let saved: DemoPlan | null = null;
    answers[`PUT /api/demos/${id}/plan`] = (body) => { saved = (body as { plan: DemoPlan }).plan; return { recording: recording({ botId, plan: saved }) }; };
    answers[`POST /api/demos/${id}/skill`] = (body) => ({ recording: recording({ botId, plan: saved!, skillName: (body as { name?: string }).name === "Harbor expense" ? "harbor-expense" : "other" }) });
    await type(labelled("Title of step 1"), "Start a new expense");
    const name = [...document.querySelectorAll<HTMLLabelElement>("label")].find((each) => each.textContent?.startsWith("Skill name"))!.querySelector("input")!;
    await type(name, "Harbor expense");
    await press(button("Save as skill"));
    await act(async () => { await Promise.resolve(); });

    expect(calls.filter((call) => call.method !== "GET").map((call) => `${call.method} ${call.path}`)).toEqual([`PUT /api/demos/${id}/plan`, `POST /api/demos/${id}/skill`]);
    expect(saved!.steps[0]!.title).toBe("Start a new expense");
    expect(review()!.querySelector("[role=status]")!.textContent).toBe("Saved as the skill harbor-expense. It is on for this bot.");
  });

  it("does not save a step whose goal names an input that is not there", async () => {
    await opened();
    await type(labelled<HTMLTextAreaElement>("Goal of step 1"), "Click it for {{nobody}}.");
    await press(button("Save as skill"));

    expect(calls.some((call) => call.method === "PUT")).toBe(false);
    expect(review()!.querySelector("[role=alert]")!.textContent).toBe("Step 1: There is no input called nobody.");
  });

  it("saves a routine with what it runs on", async () => {
    const botId = await opened({ skillName: "harbor-expense" });
    const id = recording().id;
    answers[`POST /api/demos/${id}/routine`] = () => ({ recording: recording({ botId, skillName: "harbor-expense", routineId: "routine-1" }) });
    await press(button("Save as routine"));
    const create = button("Create routine")!;
    expect(create.disabled).toBe(true);
    const source = [...document.querySelectorAll<HTMLLabelElement>("label")].find((each) => each.textContent?.startsWith("What it runs on"))!.querySelector("input")!;
    await type(source, "The new files in my receipts folder");
    await press(button("Create routine"));
    await act(async () => { await Promise.resolve(); });

    expect(calls.at(-1)).toMatchObject({ method: "POST", path: `/api/demos/${id}/routine`, body: { name: "Submit expense · Harbor Expenses", source: "The new files in my receipts folder" } });
    expect(review()!.querySelector("[role=status]")!.textContent).toContain("Saved as a routine");
  });

  it("will not run on files while the person still holds the browser", async () => {
    listed = [recording()];
    await mount(true);
    await press(button("Shown tasks: 1", host));
    await press([...host.querySelectorAll("li button")].find((each) => each.textContent?.includes("Submit expense")));

    expect(button("Run on files")!.disabled).toBe(true);
    expect(button("Run on files")!.title).toBe("Hand control back first: Nova does it in its own browser.");
  });
});

describe("doing it again", () => {
  const run = (more: Partial<DemoReplayRun> = {}): DemoReplayRun => ({
    id: "run-1", recordingId: recording().id, status: "running", done: 1, failed: 0,
    items: [
      { id: "a", label: "02-lumen-rail.json", status: "done", values: {}, missing: [], byBot: 0 },
      { id: "b", label: "03-papertrail-supply.txt", status: "running", values: {}, missing: [], byBot: 1, step: "Enter Amount" },
      { id: "c", label: "04-kestrel-cloud.txt", status: "waiting", values: {}, missing: [], byBot: 0 },
    ],
    ...more,
  });

  it("shows how far it is and what it is on, and stops when asked", async () => {
    listed = [recording()];
    const botId = await mount(false);
    await act(async () => { publishDemoChange({ botId, run: run() }); });

    expect(strip()!.dataset.demoRecorder).toBe("replay");
    expect(strip()!.querySelector("[role=status]")!.textContent).toBe("Doing it again · 2 of 3");
    expect(strip()!.textContent).toContain("03-papertrail-supply.txt · Enter Amount");
    await press(button("Stop", host));
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: `/api/demos/${recording().id}/replay/stop` });
  });

  it("lists each file with what happened to it", async () => {
    listed = [recording()];
    const botId = await mount(false);
    await act(async () => {
      publishDemoChange({ botId, run: run({ status: "done", done: 1, failed: 1, items: [
        { id: "a", label: "02-lumen-rail.json", status: "done", values: {}, missing: [], byBot: 2 },
        { id: "b", label: "bad-date.txt", status: "failed", values: {}, missing: [], byBot: 0, step: "Click Submit expense", note: "The screen says: Date must look like 2026-11-03." },
        { id: "c", label: "scrap.txt", status: "skipped", values: {}, missing: ["merchant", "date"], byBot: 0 },
      ] }) });
    });

    expect(strip()!.querySelector("[role=status]")!.textContent).toBe("Done: 1 of 3. 2 need a look");
    await press(button("Show files", host));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-demo-run-item]")].map((row) => [row.dataset.demoRunItem, row.textContent]);
    expect(rows[0]).toEqual(["done", expect.stringContaining("Nova stepped in for 2 steps")]);
    expect(rows[1]).toEqual(["failed", expect.stringContaining("Click Submit expense: The screen says: Date must look like 2026-11-03.")]);
    expect(rows[2]).toEqual(["skipped", expect.stringContaining("No value found for merchant, date")]);
    await press(button("Close", host));
    expect(strip()!.dataset.demoRecorder).toBe("idle");
  });
});
