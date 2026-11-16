import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DemoContext, DemoRect, DemoTarget } from "../../../shared/demo-recording.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { createDemoCapture, MODIFIER, type AccessibilityProbe, type CaptureDeps, type RawInput, type ScreenSource } from "../capture.ts";
import { createFrameStore } from "../frames.ts";
import { blankPicture, encodePng } from "../testing/png.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

const textbox = (name: string, y = 100): DemoTarget => ({ role: "textbox", name, secure: false, bounds: { x: 20, y, width: 300, height: 28 } });
const button = (name: string, y = 300): DemoTarget => ({ role: "button", name, secure: false, bounds: { x: 20, y, width: 120, height: 32 } });

interface Scene {
  probe: AccessibilityProbe;
  screen: ScreenSource & { shots: number; same: boolean };
  /** What is under each point, by "x,y". */
  under: Map<string, DemoTarget>;
  focus: DemoTarget | null;
  secure: DemoRect[] | null;
  context: DemoContext;
  texts: string[];
}

function scene(kind: AccessibilityProbe["kind"] = "dom"): Scene {
  const state: Scene = {
    under: new Map(),
    focus: null,
    secure: [],
    context: { title: "Expenses", url: "http://127.0.0.1:4173/portal.html" },
    texts: [],
    probe: {
      kind,
      at: async (point) => state.under.get(`${point.x},${point.y}`) ?? null,
      focused: async () => state.focus,
      secureRegions: async () => state.secure,
      context: async () => state.context,
      texts: async () => state.texts,
    },
    screen: {
      shots: 0,
      same: false,
      async frame() {
        const shade = state.screen.same ? 10 : (++state.screen.shots * 7) % 250;
        return { data: encodePng(blankPicture(64, 48, [shade, 120, 200])), type: "image/png", width: 64, height: 48 };
      },
    },
  };
  return state;
}

function capture(on: Scene, extra: Partial<CaptureDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dusk-demo-capture-"));
  dirs.push(dir);
  let now = 1_000;
  return createDemoCapture({ surface: "browser", probe: on.probe, screen: on.screen, frames: createFrameStore({ dir }), now: () => (now += 25), ...extra });
}

const click = (x: number, y: number, more: Partial<Extract<RawInput, { type: "pointer" }>> = {}): RawInput[] => [
  { type: "pointer", action: "down", x, y, button: "left", clickCount: 1, ...more },
  { type: "pointer", action: "up", x, y, button: "left", clickCount: 1, ...more },
];
const keys = (text: string): RawInput[] => [...text].flatMap((key): RawInput[] => [{ type: "key", action: "down", key, text: key }, { type: "key", action: "up", key }]);
const press = (key: string, modifiers = 0): RawInput[] => [{ type: "key", action: "down", key, modifiers }, { type: "key", action: "up", key, modifiers }];

async function feed(recording: ReturnType<typeof capture>, inputs: RawInput[]) {
  for (const input of inputs) await recording.input(input);
}

describe("capturing a demonstration", () => {
  it("records a click with what was clicked and a picture before and after", async () => {
    const on = scene();
    on.under.set("80,316", button("New expense"));
    const recording = capture(on);
    await feed(recording, click(80, 316));
    const trace = await recording.finish();

    expect(trace.surface).toBe("browser");
    expect(trace.accessibility).toBe("dom");
    expect(trace.events).toHaveLength(1);
    const [event] = trace.events;
    expect(event).toMatchObject({ seq: 1, kind: "click", point: { x: 80, y: 316 }, target: { role: "button", name: "New expense", secure: false }, context: { title: "Expenses" } });
    expect(event!.at).toBeGreaterThan(0);
    expect(event!.before).toBeTruthy();
    expect(event!.after).toBeTruthy();
    expect(event!.after).not.toBe(event!.before);
    expect(trace.frames.map((frame) => frame.id)).toEqual(expect.arrayContaining([event!.before, event!.after]));
    expect(trace.truncated).toBe(false);
    expect(recording.eventCount).toBe(1);
  });

  it("joins keys into the text that ended up in the field", async () => {
    const on = scene();
    on.under.set("60,114", textbox("Amount"));
    const recording = capture(on);
    await feed(recording, click(60, 114));
    on.focus = textbox("Amount");
    await feed(recording, [...keys("18.5"), ...press("Backspace"), ...keys("40")]);
    const trace = await recording.finish();

    const typed = trace.events.filter((event) => event.kind === "type");
    expect(typed).toHaveLength(1);
    expect(typed[0]).toMatchObject({ kind: "type", text: "18.40", target: { role: "textbox", name: "Amount" } });
    expect(typed[0]!.secure).toBeUndefined();
    expect(trace.events.filter((event) => event.kind === "key")).toHaveLength(0);
  });

  it("starts a new run of text when focus moves to another field", async () => {
    const on = scene();
    const recording = capture(on);
    on.focus = textbox("Merchant");
    await feed(recording, keys("Blue Door"));
    await feed(recording, press("Tab"));
    on.focus = textbox("Amount", 140);
    await feed(recording, keys("18.40"));
    const trace = await recording.finish();

    const typed = trace.events.filter((event) => event.kind === "type");
    expect(typed.map((event) => [event.target?.name, event.text])).toEqual([["Merchant", "Blue Door"], ["Amount", "18.40"]]);
  });

  it("keeps Enter and shortcuts as keys, never as text", async () => {
    const on = scene();
    const recording = capture(on);
    on.focus = textbox("Notes");
    await feed(recording, [...keys("ok"), ...press("Enter"), ...press("s", MODIFIER.ctrl), ...press("P", MODIFIER.meta | MODIFIER.shift)]);
    const trace = await recording.finish();

    expect(trace.events.map((event) => event.kind)).toEqual(["type", "key", "key", "key"]);
    expect(trace.events.slice(1).map((event) => event.key)).toEqual(["Enter", "Control+S", "Shift+Meta+P"]);
    expect(trace.events[0]!.text).toBe("ok");
  });

  it("takes pasted text into the run", async () => {
    const on = scene();
    const recording = capture(on);
    on.focus = textbox("Notes");
    await feed(recording, [...keys("Lunch "), { type: "text", text: "with the Alder team" }]);
    const trace = await recording.finish();

    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({ kind: "type", text: "Lunch with the Alder team" });
  });

  it("tells a double click, a right click and a drag from a click", async () => {
    const on = scene();
    on.under.set("50,50", button("Row", 40));
    const recording = capture(on);
    await feed(recording, [...click(50, 50), ...click(50, 50, { clickCount: 2 })]);
    await feed(recording, click(50, 50, { button: "right" }));
    await feed(recording, [
      { type: "pointer", action: "down", x: 50, y: 50, button: "left" },
      { type: "pointer", action: "move", x: 120, y: 90 },
      { type: "pointer", action: "move", x: 200, y: 160 },
      { type: "pointer", action: "up", x: 200, y: 160, button: "left" },
    ]);
    const trace = await recording.finish();

    expect(trace.events.map((event) => event.kind)).toEqual(["double-click", "right-click", "drag"]);
    expect(trace.events[2]).toMatchObject({ point: { x: 50, y: 50 }, to: { x: 200, y: 160 } });
  });

  it("makes one scroll of a run of wheel turns and nothing of the pointer moving", async () => {
    const on = scene();
    const recording = capture(on);
    await feed(recording, [
      { type: "pointer", action: "move", x: 10, y: 10 },
      { type: "pointer", action: "move", x: 30, y: 40 },
      { type: "wheel", x: 30, y: 40, deltaX: 0, deltaY: 120 },
      { type: "wheel", x: 30, y: 40, deltaX: 0, deltaY: 240 },
      { type: "wheel", x: 30, y: 40, deltaX: 4, deltaY: 90 },
    ]);
    const trace = await recording.finish();

    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({ kind: "scroll", direction: "down" });
  });

  it("takes no picture while the pointer only moves", async () => {
    const on = scene();
    const recording = capture(on);
    await feed(recording, [{ type: "pointer", action: "move", x: 10, y: 10 }, { type: "pointer", action: "move", x: 30, y: 40 }]);
    expect(on.screen.shots).toBe(0);
    const trace = await recording.finish();
    expect(trace.events).toHaveLength(0);
  });

  it("records a choice from a list and an address that was opened", async () => {
    const on = scene();
    on.under.set("60,200", { role: "combobox", name: "Category", secure: false, choices: ["Meals", "Travel"] });
    const recording = capture(on);
    await feed(recording, [{ type: "open", url: "http://127.0.0.1:4173/portal.html?signedIn=1" }, { type: "choose", x: 60, y: 200, label: "Travel" }]);
    const trace = await recording.finish();

    expect(trace.events[0]).toMatchObject({ kind: "open", url: "http://127.0.0.1:4173/portal.html?signedIn=1" });
    expect(trace.events[1]).toMatchObject({ kind: "choose", text: "Travel", target: { role: "combobox", name: "Category", choices: ["Meals", "Travel"] } });
  });

  it("notes the headings and notices an action brought up", async () => {
    const on = scene();
    on.under.set("80,316", button("Submit expense"));
    on.texts = ["New expense"];
    const recording = capture(on);
    await recording.input(click(80, 316)[0]!);
    on.texts = ["Expenses", "Expense EXP-1001 submitted: Blue Door Coffee, $18.40"];
    await recording.input(click(80, 316)[1]!);
    const trace = await recording.finish();

    expect(trace.events[0]!.appeared).toEqual(["Expenses", "Expense EXP-1001 submitted: Blue Door Coffee, $18.40"]);
  });

  it("keeps one picture when the screen did not change", async () => {
    const on = scene();
    on.screen.same = true;
    on.under.set("80,316", button("Refresh"));
    const recording = capture(on);
    await feed(recording, [...click(80, 316), ...click(80, 316)]);
    const trace = await recording.finish();

    expect(trace.frames).toHaveLength(1);
    expect(trace.events.every((event) => event.before === trace.frames[0]!.id && event.after === trace.frames[0]!.id)).toBe(true);
  });

  it("keeps positions and pictures, and nothing typed, when there is no accessibility", async () => {
    const on = scene("none");
    on.secure = null;
    const recording = capture(on, { surface: "computer" });
    await feed(recording, [...click(412, 300), ...keys("Blue Door Coffee")]);
    const trace = await recording.finish();

    expect(trace.accessibility).toBe("none");
    expect(trace.events[0]).toMatchObject({ kind: "click", point: { x: 412, y: 300 } });
    expect(trace.events[0]!.target).toBeUndefined();
    expect(trace.events[0]!.before).toBeTruthy();
    expect(trace.events[1]).toMatchObject({ kind: "type", secure: true, chars: 16 });
    expect(trace.events[1]!.text).toBeUndefined();
  });

  it("stops taking events at its limit and says so", async () => {
    const on = scene();
    on.under.set("80,316", button("Next"));
    const recording = capture(on, { limits: { maxEvents: 3 } });
    for (let i = 0; i < 6; i++) await feed(recording, click(80, 316));
    const trace = await recording.finish();

    expect(trace.events).toHaveLength(3);
    expect(trace.truncated).toBe(true);
  });

  it("runs kept text through the scrubber it was given", async () => {
    const on = scene();
    const recording = capture(on, { scrub: (text) => text.replaceAll("tide-pool", "[hidden]") });
    on.focus = textbox("Notes");
    await feed(recording, keys("code tide-pool here"));
    const trace = await recording.finish();

    expect(trace.events[0]!.text).toBe("code [hidden] here");
  });

  it("gives back the trace it finished with when asked twice", async () => {
    const on = scene();
    on.under.set("80,316", button("Next"));
    const recording = capture(on);
    await feed(recording, click(80, 316));
    const first = await recording.finish();
    await feed(recording, click(80, 316));
    const second = await recording.finish();

    expect(second.events).toHaveLength(1);
    expect(second.durationMs).toBe(first.durationMs);
  });
});
