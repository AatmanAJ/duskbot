// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Routine } from "@/lib/routines";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: fixture.state, dispatch: vi.fn() }),
  api: vi.fn(async () => ({})),
}));

const { BotRoutines } = await import("./BotRoutines");
const { applyAppTriggerSnapshot } = await import("@/lib/app-triggers");

const now = Date.now();
const scout = { id: "bot-a", name: "Scout", color: "green", threadId: "thread-a", hidden: false, messages: [], tasks: [] } as unknown as Bot;
const routine: Routine = {
  id: "routine-1", name: "Morning summary", prompt: "Send me a summary of my inbox.", target: "bot", botId: "bot-a", runOn: "maus", enabled: true,
  schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }, durationMinutes: 30, nextRunAt: now + 3_600_000, createdAt: now, updatedAt: now,
};
const run = (id: string, status: string, extra: Record<string, unknown>) => ({ id, routineId: "routine-1", routineName: "Morning summary", target: "bot", botId: "bot-a",
  runOn: "maus", scheduledFor: now - 60_000, startedAt: now - 60_000, status, manual: false, threadId: `thread-${id}`, createdAt: now - 60_000, ...extra });

let root: Root;
let container: HTMLElement;
beforeEach(() => {
  fixture.state = {
    hydrated: true, bots: [scout], groups: [], routines: [routine], webhooks: [], routinesFocus: { nonce: 0 }, config: {},
    routineRuns: [
      run("run-ok", "completed", { output: "Three new emails, none urgent." }),
      run("run-bad", "failed", { error: "The inbox could not be reached." }),
    ],
  };
  applyAppTriggerSnapshot({ triggers: [], attempts: [], service: { available: true, plan: "desktop", eventsPerDay: 500, eventsToday: 0 } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root.render(createElement(BotRoutines, { bot: scout })));
  flushSync(() => container.querySelector<HTMLButtonElement>('[data-panel-routine="routine-1"] button[aria-haspopup=dialog]')!.click());
});
afterEach(() => { root.unmount(); document.body.innerHTML = ""; });

/** What a screen reader reads for an element: its text without the parts hidden from assistive tech. */
function spoken(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll("[aria-hidden=true]")) hidden.remove();
  return copy.textContent ?? "";
}

it("a recent run says in words whether it worked, not only with a coloured mark", () => {
  const failed = document.querySelector<HTMLElement>('[data-routine-run="run-bad"]')!;
  const done = document.querySelector<HTMLElement>('[data-routine-run="run-ok"]')!;
  expect(spoken(failed)).not.toMatch(/[✓✗]/);
  expect(spoken(failed)).toMatch(/failed/i);
  expect(spoken(done)).not.toMatch(/[✓✗]/);
  expect(spoken(done)).toMatch(/done|worked|finished/i);
});
