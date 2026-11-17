// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { publishLiveFrame } from "@/lib/live-events";
import type { DemoDraft, DemoStep } from "../../shared/demo-recording";

const calls: Array<{ path: string; method: string; body?: unknown }> = [];
let answer: (path: string, method: string, body: unknown) => unknown = () => ({});

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body) as unknown : undefined;
      calls.push({ path, method, ...(body === undefined ? {} : { body }) });
      const result = answer(path, method, body);
      if (result instanceof Error) throw result;
      return result;
    }),
  };
});
vi.mock("./ConfirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const { ApiError } = await import("@/state/api");
const { DemoRecorder } = await import("./DemoRecorder");

const BASE = "/api/bots/bot-ada/demo-recording";
const STEPS: DemoStep[] = [
  { id: "s1", kind: "open", url: "https://portal.example/login" },
  { id: "s9", kind: "sign-in", site: "portal.example" },
  { id: "s30", kind: "click", target: { role: "link", name: "New expense report" } },
  { id: "s41", kind: "fill", target: { role: "textbox", name: "", label: "Amount (USD)" }, value: "18.40", blank: "amount_usd" },
  { id: "s50", kind: "choose", target: { role: "radiogroup", name: "Paid with" }, value: "Company card" },
  { id: "s60", kind: "click", target: { role: "button", name: "Submit report" } },
];
const draftOf = (extra: Partial<DemoDraft>): DemoDraft => ({
  botId: "bot-ada", state: "idle", place: "browser", startedAt: null, title: "", startUrl: "", steps: [], blanks: [], named: null, revision: 1, ...extra,
});
const REVIEW = draftOf({ state: "review", title: "Submit report on portal.example", steps: STEPS, revision: 9, named: "labels",
  blanks: [{ name: "amount_usd", label: "Amount (USD)", example: "18.40", kind: "text" }] });

let root: Root | null = null;
let host: HTMLDivElement;

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    flushSync(() => {});
  }
}

/** Mounts the recorder; `initial` reaches it the way a draft does: asked for while the person holds control, and
 * over the events feed otherwise. */
async function mount(props: { canRecord: boolean; initial?: DemoDraft }): Promise<void> {
  answer = (path, method) => (path === BASE && method === "GET" ? { draft: props.initial ?? draftOf({ revision: 0 }) } : {});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(DemoRecorder, { botId: "bot-ada", botName: "Ada", place: "browser", canRecord: props.canRecord })));
  await settle();
  expect(calls).toEqual(props.canRecord ? [{ path: BASE, method: "GET" }] : []);
  if (!props.canRecord && props.initial) {
    publishLiveFrame({ kind: "demo-recording", botId: "bot-ada", draft: props.initial } as never);
    await settle();
  }
  calls.length = 0;
}

const button = (name: string) => [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name) as HTMLButtonElement | undefined;
const rows = () => [...host.querySelectorAll("li")].map((row) => row.querySelector("span.truncate")?.textContent ?? "");
const click = async (name: string) => { button(name)!.click(); await settle(); };

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync(() => {});
}

beforeEach(() => { calls.length = 0; });
afterEach(() => {
  flushSync(() => root?.unmount());
  root = null;
  host?.remove();
});

describe("the Show it once recorder in the browser panel", () => {
  it("shows nothing until the person holds control, then a Record button that starts a recording here", async () => {
    await mount({ canRecord: false });
    expect(host.textContent).toBe("");
    flushSync(() => root!.unmount());
    host.remove();

    await mount({ canRecord: true });
    expect(host.textContent).toContain("Do a task once and Ada learns it as a skill.");
    answer = () => ({ draft: draftOf({ state: "recording", revision: 2, startedAt: 1 }) });
    await click("Record");
    expect(calls).toEqual([{ path: `${BASE}/start`, method: "POST", body: { place: "browser" } }]);
    expect(host.querySelector("[data-demo-recorder]")!.getAttribute("data-demo-recorder")).toBe("recording");
    expect(host.textContent).toContain("Recording");
    expect(host.textContent).toContain("Do the task in the page. Each thing you do shows up here.");
  });

  it("lists each step in words as it is recorded, a sign-in as one line that names the vault", async () => {
    await mount({ canRecord: true, initial: draftOf({ state: "recording", revision: 2 }) });
    publishLiveFrame({ kind: "demo-recording", botId: "bot-ada", draft: draftOf({ state: "recording", revision: 5, steps: STEPS.slice(0, 5).map(({ blank: _blank, ...step }) => step) }) } as never);
    await settle();
    expect(rows()).toEqual([
      "Open portal.example/login",
      "Sign in to portal.example with your saved login",
      "Click “New expense report”",
      "Type “18.40” into “Amount (USD)”",
      "Pick “Company card” in “Paid with”",
    ]);
    expect(host.textContent).toContain("5 steps");
    expect(host.querySelector('li[data-step-kind="sign-in"]')!.textContent).toContain("Vault");
    publishLiveFrame({ kind: "demo-recording", botId: "bot-ada", draft: draftOf({ state: "recording", revision: 3, steps: [] }) } as never);
    publishLiveFrame({ kind: "demo-recording", botId: "bot-other", draft: draftOf({ botId: "bot-other", state: "recording", revision: 99, steps: [] }) } as never);
    await settle();
    expect(rows()).toHaveLength(5);

    answer = () => ({ draft: REVIEW });
    await click("Stop");
    expect(calls).toEqual([{ path: `${BASE}/stop`, method: "POST" }]);
    expect(host.querySelector("[data-demo-recorder]")!.getAttribute("data-demo-recorder")).toBe("review");
    expect(rows()[3]).toBe("Type amount_usd into “Amount (USD)”");
    expect(host.textContent).toContain("6 steps · 1 blank");
  });

  it("stays to review once control is handed back, and edits the list: a blank renamed, a value made a blank, a step deleted", async () => {
    await mount({ canRecord: false, initial: REVIEW });
    expect(rows()).toHaveLength(6);
    expect(button("Record")).toBeUndefined();

    await click("Rename the blank amount_usd");
    const field = host.querySelector('input[aria-label="Name of the blank"]') as HTMLInputElement;
    type(field, "Total Amount");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(calls).toEqual([{ path: `${BASE}/blanks`, method: "POST", body: { from: "amount_usd", to: "total_amount" } }]);

    calls.length = 0;
    await click("Rename the blank amount_usd");
    const again = host.querySelector('input[aria-label="Name of the blank"]') as HTMLInputElement;
    type(again, "9 lives!");
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(calls).toEqual([]);
    expect(again.getAttribute("aria-invalid")).toBe("true");
    again.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();

    const make = [...host.querySelectorAll("button")].filter((candidate) => candidate.textContent === "Make it a blank");
    expect(make).toHaveLength(1);
    make[0]!.click();
    await settle();
    await click("Keep this value");
    await click("Delete step 3");
    expect(calls).toEqual([
      { path: `${BASE}/steps/s50`, method: "PATCH", body: { blank: "paid_with" } },
      { path: `${BASE}/steps/s41`, method: "PATCH", body: { blank: null } },
      { path: `${BASE}/steps/s30`, method: "DELETE" },
    ]);
  });

  it("saves as a skill under the name the person gave the task", async () => {
    await mount({ canRecord: false, initial: REVIEW });
    const title = host.querySelector('input[aria-label="Name of the task"]') as HTMLInputElement;
    expect(title.value).toBe("Submit report on portal.example");
    type(title, "File an expense report");
    answer = (path) => (path.endsWith("/save") ? { skill: "file-an-expense-report" } : { draft: { ...REVIEW, title: "File an expense report", revision: 10 } });
    await click("Save as skill");
    expect(calls).toEqual([
      { path: `${BASE}/title`, method: "POST", body: { title: "File an expense report" } },
      { path: `${BASE}/save`, method: "POST", body: { as: "skill" } },
    ]);
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Saved as the skill file-an-expense-report.");
    expect(host.textContent).toContain("Ask Ada to do it again, for one item or for every file in a folder.");
    await click("Done");
    expect(host.textContent).toBe("");
  });

  it("saves as a routine over a folder, and says so", async () => {
    await mount({ canRecord: true, initial: REVIEW });
    await click("Save as routine");
    const folder = host.querySelector('input[placeholder="/Users/you/Expenses"]') as HTMLInputElement;
    type(folder, " /Users/ada/Expenses ");
    answer = () => ({ skill: "submit-report-on-portal-example", routineId: "r1" });
    await click("Save routine");
    expect(calls).toEqual([{ path: `${BASE}/save`, method: "POST", body: { as: "routine", folder: "/Users/ada/Expenses" } }]);
    expect(host.textContent).toContain("A routine was set up too. It stays off until you turn it on.");
    expect(button("Record another")).toBeDefined();
  });

  it("says in plain words why it could not record or save", async () => {
    await mount({ canRecord: true });
    answer = () => new ApiError("Take control first: a task is recorded only while you are the one using the browser.", 409, { error: "x", code: "not-held" });
    await click("Record");
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Take control first, then record.");
    answer = () => new ApiError("x", 409, { error: "x", code: "no-page" });
    await click("Record");
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Open the page in the browser on Ada’s computer first, then record again.");
    answer = () => new ApiError("TypeError: fetch failed at node:internal", 500, {});
    await click("Record");
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("That did not work. Try again.");
  });

  it("asks before it throws a recording away", async () => {
    await mount({ canRecord: false, initial: REVIEW });
    answer = () => ({ draft: draftOf({ revision: 12 }) });
    await click("Discard");
    expect(calls).toEqual([{ path: `${BASE}/discard`, method: "POST" }]);
    expect(host.textContent).toBe("");
  });
});
