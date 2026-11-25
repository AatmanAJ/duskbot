// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEACH_TASK_LINE, type TaughtStep, type TeachStatus } from "../../../shared/teach-task";
import type { Bot } from "@/state/store";

const calls: Array<{ path: string; body?: unknown }> = [];
const dispatch = vi.fn();
let answer: TeachStatus = { recording: false, steps: [] };

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: original.initialState, dispatch }),
    api: async (path: string, init?: { body?: string }) => {
      calls.push({ path, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
      return answer;
    },
  };
});

const { TeachBar, TeachReview, useTeachTask, withoutStep } = await import("./TeachTask");

const bot = { id: "juno", name: "Juno", threadId: "thread-1" } as Bot;
const STEPS: TaughtStep[] = [
  { kind: "page", url: "https://shop.example/", title: "Tea shop" },
  { kind: "click", target: { role: "searchbox", name: "Search teas" } },
  { kind: "type", target: { role: "searchbox", name: "Search teas" }, text: "sencha" },
  { kind: "type", target: { role: "textbox", name: "Password" }, text: "", hidden: true },
  { kind: "page", url: "https://shop.example/basket", title: "Basket" },
  { kind: "click", target: { role: "button", name: "Add to basket" } },
];

function Harness({ takeControl }: { takeControl: () => void }) {
  const task = useTeachTask({ bot, scope: {}, connected: true, takeControl });
  return createElement("div", null,
    createElement("button", { type: "button", "data-start": "", onClick: () => void task.start() }, "start"),
    createElement(TeachBar, { task, botName: bot.name, you: false, onTake: takeControl }),
    createElement(TeachReview, { task, botName: bot.name }));
}

describe("teach a task in the browser panel", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    calls.length = 0;
    dispatch.mockReset();
    answer = { recording: false, steps: [] };
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); };
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

  it("records with the person in control, then hands the reviewed steps to the bot as a teach message", async () => {
    const takeControl = vi.fn();
    await act(async () => root.render(createElement(Harness, { takeControl })));
    await flush();
    answer = { recording: true, startedAt: Date.now(), endsAt: Date.now() + 600_000, steps: STEPS.slice(0, 2) };
    await act(async () => host.querySelector<HTMLButtonElement>("[data-start]")!.click());
    await flush();
    expect(calls.at(-1)).toEqual({ path: "/api/bots/juno/browser/teach", body: { action: "start" } });
    expect(takeControl).toHaveBeenCalledOnce();
    const bar = host.querySelector("[role=status]")!;
    expect(bar.textContent).toContain("Showing Juno a task");
    expect(bar.textContent).toContain("1 step");
    expect(bar.textContent).toContain("never kept");

    answer = { recording: false, startedAt: Date.now(), stopped: "person", steps: STEPS };
    const stop = [...bar.querySelectorAll("button")].find((button) => button.textContent === "Stop and review")!;
    await act(async () => stop.click());
    await flush();
    const dialog = host.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).toContain("Typed “sencha” into searchbox “Search teas”");
    expect(dialog.textContent).toContain("Typed into textbox “Password” (private, not kept)");
    const send = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Teach Juno")!;
    expect(send.disabled).toBe(true);

    await act(async () => dialog.querySelector<HTMLButtonElement>("[aria-label='Remove step 4']")!.click());
    expect(dialog.textContent).not.toContain("Basket");
    const name = dialog.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Find a tea");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(send.disabled).toBe(false);
    answer = { recording: false, steps: [] };
    await act(async () => send.click());
    await flush();

    expect(dispatch).toHaveBeenCalledOnce();
    const sent = dispatch.mock.calls[0]![0] as { type: string; botId: string; threadId: string; text: string };
    expect(sent).toMatchObject({ type: "send", botId: "juno", threadId: "thread-1" });
    expect(sent.text.startsWith(TEACH_TASK_LINE)).toBe(true);
    expect(sent.text).toContain("Task: Find a tea");
    expect(sent.text).toContain("2. Typed “sencha” into the searchbox “Search teas”");
    expect(sent.text).not.toContain("Add to basket");
    expect(calls.at(-1)).toEqual({ path: "/api/bots/juno/browser/teach", body: { action: "discard" } });
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("drops a page line once no step is left under it", () => {
    expect(withoutStep(STEPS, 5).map((step) => step.kind)).toEqual(["page", "click", "type", "type"]);
  });
});
