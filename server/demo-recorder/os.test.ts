// A desktop's accessibility, read through the computer driver's tools with the driver itself stood in for: what a
// recording learns of a click and a typed field, and how a plan is carried out by what things are called.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { createOsProbe, createOsSurface, type DesktopTools } from "./accessibility/os.ts";
import { createDemoCapture, type RawInput } from "./capture.ts";
import { compileDemo } from "./compiler.ts";
import { createFrameStore } from "./frames.ts";
import { runReplay } from "./replay.ts";
import { blankPicture, encodePng } from "./testing/png.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

interface Row { role: string; label?: string; value?: string; frame?: { x: number; y: number; w: number; h: number } }

/** A desktop with one app window whose rows the test sets, and a record of every tool call. */
function desktop(rows: Row[], more: { screenFrames?: boolean; fail?: boolean; refuse?: string[] } = {}) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const state = { rows, title: "Invoice 0042 - Ledger", shots: 0 };
  const tools: DesktopTools = {
    async call(tool, args) {
      calls.push({ tool, args });
      if (more.fail) throw new Error("the driver is not running");
      if (tool === "list_windows") {
        return { windows: [
          { pid: 77, window_id: 9, app_name: "Files", title: "Home", bounds: { x: 0, y: 0, width: 400, height: 300 }, z_index: 1 },
          { pid: 4242, window_id: 31, app_name: "Ledger", title: state.title, bounds: { x: 100, y: 50, width: 800, height: 600 }, z_index: 5 },
        ] };
      }
      if (tool === "get_window_state") {
        return { structuredContent: { window_title: state.title, app_name: "Ledger", element_count: state.rows.length, elements: state.rows.map((row, index) => ({
          element_index: index, element_token: `tok-${index}`, role: row.role, label: row.label ?? "", ...(row.value !== undefined ? { value: row.value } : {}),
          ...(row.frame ? { frame: more.screenFrames ? { ...row.frame, x: row.frame.x + 100, y: row.frame.y + 50 } : row.frame } : {}),
        })) } };
      }
      if (more.refuse?.includes(tool)) return { status: "refused", reason: "The window is not accepting input." };
      const index = Number(String(args.element_token ?? "").replace("tok-", ""));
      const row = state.rows[index];
      if (tool === "type_text" && row) row.value = String(args.text);
      if (tool === "press_key" && args.key === "delete" && row) row.value = "";
      if (tool === "set_value" && row) row.value = String(args.value);
      if (tool === "click" && row?.label === "Save") state.title = "Saved - Ledger";
      return { status: "ok" };
    },
    async frame() {
      state.shots++;
      return { data: encodePng(blankPicture(32, 20, [state.shots * 9, 80, 120])), type: "image/png", width: 32, height: 20 };
    },
  };
  return { tools, calls, state };
}

const LEDGER = (): Row[] => [
  { role: "AXGroup", label: "", frame: { x: 0, y: 0, w: 800, h: 600 } },
  { role: "AXStaticText", label: "Invoice", frame: { x: 20, y: 20, w: 200, h: 24 } },
  { role: "AXTextField", label: "Customer", value: "Alder & Co", frame: { x: 20, y: 80, w: 300, h: 28 } },
  { role: "entry", label: "Amount", value: "", frame: { x: 20, y: 130, w: 300, h: 28 } },
  { role: "AXPopUpButton", label: "Terms", value: "Net 30", frame: { x: 20, y: 180, w: 300, h: 28 } },
  { role: "check box", label: "Send a copy", value: "1", frame: { x: 20, y: 230, w: 200, h: 24 } },
  { role: "push button", label: "Save", frame: { x: 20, y: 300, w: 120, h: 32 } },
  { role: "AXHeading", label: "Line items", frame: { x: 20, y: 360, w: 300, h: 24 } },
];

const typed = (text: string): RawInput[] => [...text].flatMap((key): RawInput[] => [{ type: "key", action: "down", key, text: key }, { type: "key", action: "up", key }]);
const down = (x: number, y: number): RawInput => ({ type: "pointer", action: "down", x, y, button: "left" });

describe("what a desktop's accessibility says about a point", () => {
  it("names the smallest thing there, by one set of role names on every system", async () => {
    const { tools } = desktop(LEDGER());
    const probe = createOsProbe(tools);

    expect(await probe.at({ x: 130, y: 142 })).toEqual({ role: "textbox", name: "Customer", secure: false, bounds: { x: 120, y: 130, width: 300, height: 28 } });
    expect(await probe.at({ x: 130, y: 192 })).toMatchObject({ role: "textbox", name: "Amount" });
    expect(await probe.at({ x: 130, y: 242 })).toMatchObject({ role: "combobox", name: "Terms" });
    expect(await probe.at({ x: 130, y: 292 })).toMatchObject({ role: "checkbox", name: "Send a copy" });
    expect(await probe.at({ x: 130, y: 362 })).toMatchObject({ role: "button", name: "Save" });
    expect(await probe.at({ x: 700, y: 500 })).toBeNull();
    expect(await probe.at({ x: 5, y: 5 })).toBeNull();
  });

  it("takes frames given in the screen's own pixels as they are", async () => {
    const { tools } = desktop(LEDGER(), { screenFrames: true });

    expect(await createOsProbe(tools).at({ x: 130, y: 142 })).toMatchObject({ name: "Customer", bounds: { x: 120, y: 130 } });
  });

  it("reads the front window's title and app, its headings and its dialogs", async () => {
    const { tools } = desktop([...LEDGER(), { role: "AXSheet", label: "Discard changes?" }]);
    const probe = createOsProbe(tools);

    expect(await probe.context()).toEqual({ title: "Invoice 0042 - Ledger", app: "Ledger" });
    expect(await probe.texts!()).toEqual(["Invoice 0042 - Ledger", "Line items", "Discard changes?"]);
  });

  it("asks the driver once for a burst of questions", async () => {
    const { tools, calls } = desktop(LEDGER());
    const probe = createOsProbe(tools);
    await Promise.all([probe.at({ x: 130, y: 142 }), probe.context(), probe.secureRegions(), probe.texts!()]);

    expect(calls.map((call) => call.tool)).toEqual(["list_windows", "get_window_state"]);
    expect(calls[1]!.args).toMatchObject({ pid: 4242, window_id: 31, include_screenshot: false });
  });
});

describe("secure fields on a desktop", () => {
  const withSecret = (role: string, label: string): Row[] => [...LEDGER(), { role, label, value: "hunter2", frame: { x: 20, y: 420, w: 300, h: 28 } }];

  it("are known by the system's role for them and by their label", async () => {
    for (const [role, label] of [["AXSecureTextField", "Passphrase"], ["password text", ""], ["entry", "Card number"], ["AXTextField", "One-time code"]] as const) {
      const { tools } = desktop(withSecret(role, label));
      expect((await createOsProbe(tools).at({ x: 130, y: 482 }))?.secure, `${role} ${label}`).toBe(true);
    }
  });

  it("keep every picture of that screen from being kept, since their boxes cannot be trusted here", async () => {
    expect(await createOsProbe(desktop(LEDGER()).tools).secureRegions()).toEqual([]);
    expect(await createOsProbe(desktop(withSecret("AXSecureTextField", "Passphrase")).tools).secureRegions()).toBeNull();
    expect(await createOsProbe(desktop(LEDGER(), { fail: true }).tools).secureRegions()).toBeNull();
  });

  it("never have their value read back when a step is checked", async () => {
    const seen = await createOsSurface(desktop(withSecret("AXSecureTextField", "Passphrase")).tools).observe();

    expect(JSON.stringify(seen)).not.toContain("hunter2");
    expect(seen.fields.find((field) => field.name === "Passphrase")!.value).not.toBe("");
  });
});

describe("recording on a desktop", () => {
  async function record(rows: Row[], inputs: RawInput[], between: (state: { rows: Row[] }, raw: RawInput) => void = () => {}) {
    const { tools, state } = desktop(rows);
    const probe = createOsProbe(tools);
    const dir = mkdtempSync(join(tmpdir(), "dusk-demo-os-"));
    dirs.push(dir);
    const capture = createDemoCapture({ surface: "computer", probe, screen: { frame: () => tools.frame() }, frames: createFrameStore({ dir }) });
    for (const raw of inputs) {
      probe.note(raw);
      await capture.input(raw);
      between(state, raw);
    }
    return capture.finish();
  }

  it("keeps nothing typed after a click on something that is not a text field", async () => {
    const trace = await record(LEDGER(), [down(130, 362), { type: "pointer", action: "up", x: 130, y: 362, button: "left" }, ...typed("hunter2")]);

    expect(trace.events.find((event) => event.kind === "type")).toMatchObject({ secure: true, chars: 7 });
    expect(JSON.stringify(trace)).not.toContain("hunter2");
  });

  it("keeps nothing typed while a secure field is anywhere on the screen, as when a prompt takes the keyboard by itself", async () => {
    const prompt: Row = { role: "AXSecureTextField", label: "", frame: { x: 200, y: 200, w: 300, h: 28 } };
    const trace = await record(LEDGER(), [down(130, 192), { type: "pointer", action: "up", x: 130, y: 192, button: "left" }, ...typed("hunter2")],
      (state, raw) => { if (raw.type === "pointer" && raw.action === "up") state.rows.push(prompt); });

    expect(trace.events.find((event) => event.kind === "type")).toMatchObject({ secure: true, chars: 7 });
    expect(JSON.stringify(trace)).not.toContain("hunter2");
  });

  it("names a click by what was there before it, when the click took that off the screen", async () => {
    const { tools, state } = desktop([...LEDGER(), { role: "push button", label: "Discard", frame: { x: 400, y: 300, w: 120, h: 32 } }]);
    let clock = 10_000;
    const probe = createOsProbe(tools, { now: () => clock });
    await probe.context();
    clock += 800;
    state.rows.pop();
    probe.note(down(510, 362));

    expect(await probe.at({ x: 510, y: 362 })).toMatchObject({ role: "button", name: "Discard" });
    expect(await probe.at({ x: 510, y: 362 })).toBeNull();
  });

  it("keeps what is typed into the field the person clicked", async () => {
    const trace = await record(LEDGER(), [down(130, 192), { type: "pointer", action: "up", x: 130, y: 192, button: "left" }, ...typed("1280.00")]);

    expect(trace.accessibility).toBe("os");
    expect(trace.events.map((event) => [event.kind, event.target?.name, event.text])).toEqual([["click", "Amount", undefined], ["type", "Amount", "1280.00"]]);
    expect(trace.events[0]!.context).toEqual({ title: "Invoice 0042 - Ledger", app: "Ledger" });
    expect(trace.frames.length).toBeGreaterThan(0);
  });

  it("keeps nothing typed after a key that could have moved focus, or into a secure field", async () => {
    const moved = await record(LEDGER(), [down(130, 192), { type: "pointer", action: "up", x: 130, y: 192, button: "left" }, ...typed("12"), { type: "key", action: "down", key: "Tab" }, ...typed("secret words")]);
    const secure = await record([...LEDGER(), { role: "password text", label: "Passphrase", frame: { x: 20, y: 420, w: 300, h: 28 } }], [down(130, 482), ...typed("hunter2")]);

    expect(moved.events.filter((event) => event.kind === "type").map((event) => [event.text, event.secure, event.chars])).toEqual([["12", undefined, undefined], [undefined, true, 12]]);
    expect(JSON.stringify(moved)).not.toContain("secret words");
    expect(secure.events.find((event) => event.kind === "type")).toMatchObject({ secure: true, chars: 7 });
    expect(JSON.stringify(secure)).not.toContain("hunter2");
    expect(secure.frames).toEqual([]);
    expect(secure.framesSkipped).toBeGreaterThan(0);
  });
});

describe("doing a task again on a desktop", () => {
  it("clicks, fills and chooses by role and name through the driver's element actions", async () => {
    const { tools, calls, state } = desktop(LEDGER());
    const surface = createOsSurface(tools);

    expect(await surface.perform({ do: "fill", role: "textbox", name: "amount", value: "1280.00" })).toEqual({ ok: true });
    expect(await surface.perform({ do: "choose", role: "combobox", name: "Terms", value: "Net 15" })).toEqual({ ok: true });
    expect(await surface.perform({ do: "click", role: "button", name: "Save" })).toEqual({ ok: true });
    const acted = calls.filter((call) => !["list_windows", "get_window_state"].includes(call.tool));
    expect(acted.map((call) => call.tool)).toEqual(["click", "hotkey", "type_text", "set_value", "click"]);
    expect(acted[0]!.args).toEqual({ pid: 4242, window_id: 31, delivery_mode: "foreground", element_token: "tok-3" });
    expect(acted[1]!.args).toMatchObject({ keys: ["ctrl", "a"], element_token: "tok-3" });
    expect(acted[2]!.args).toMatchObject({ text: "1280.00", element_token: "tok-3" });
    expect(acted[3]!.args).toEqual({ pid: 4242, window_id: 31, element_token: "tok-4", value: "Net 15" });
    expect(state.rows[3]!.value).toBe("1280.00");
    expect((await surface.observe()).fields).toEqual(expect.arrayContaining([{ role: "textbox", name: "Amount", value: "1280.00" }, { role: "combobox", name: "Terms", value: "Net 15" }]));
    expect((await surface.observe()).title).toBe("Saved - Ledger");
  });

  it("presses keys and shortcuts by the driver's names for them", async () => {
    const { tools, calls } = desktop(LEDGER());
    const surface = createOsSurface({ ...tools, mac: true });
    await surface.perform({ do: "press", key: "Enter" });
    await surface.perform({ do: "press", key: "Control+S" });
    await surface.perform({ do: "press", key: "Shift+Meta+P" });
    await surface.perform({ do: "fill", role: "textbox", name: "Amount", value: "" });
    const acted = calls.filter((call) => !["list_windows", "get_window_state"].includes(call.tool));

    expect(acted.slice(0, 3).map((call) => [call.tool, call.args.key ?? call.args.keys])).toEqual([["press_key", "return"], ["hotkey", ["ctrl", "s"]], ["hotkey", ["shift", "cmd", "p"]]]);
    expect(acted.slice(3).map((call) => [call.tool, call.args.key ?? call.args.keys])).toEqual([["click", undefined], ["hotkey", ["cmd", "a"]], ["press_key", "delete"]]);
  });

  it("says what it could not find, what is named twice, and what the driver refused", async () => {
    const twice = desktop([...LEDGER(), { role: "AXButton", label: "Save" }]);
    const refused = desktop(LEDGER(), { refuse: ["click"] });

    expect(await createOsSurface(desktop(LEDGER()).tools).perform({ do: "click", role: "button", name: "Send" })).toEqual({ ok: false, reason: "Could not find the button \"Send\" in the window \"Invoice 0042 - Ledger\"." });
    expect(await createOsSurface(twice.tools).perform({ do: "click", role: "button", name: "Save" })).toMatchObject({ ok: false, reason: expect.stringMatching(/more than one/i) });
    expect(await createOsSurface(refused.tools).perform({ do: "click", role: "button", name: "Save" })).toEqual({ ok: false, reason: "The window is not accepting input." });
    expect(await createOsSurface(desktop(LEDGER(), { fail: true }).tools).perform({ do: "click", role: "button", name: "Save" })).toEqual({ ok: false, reason: "the driver is not running" });
    expect(await createOsSurface(desktop(LEDGER()).tools).perform({ do: "open", url: "https://example.com" })).toMatchObject({ ok: false });
  });

  it("never passes a secret to the driver, whose arguments other programs can read", async () => {
    const { tools, calls } = desktop([...LEDGER(), { role: "AXSecureTextField", label: "Passphrase" }]);
    const surface = createOsSurface(tools);
    const asSecret = await surface.perform({ do: "fill", role: "textbox", name: "Amount", value: "hunter2" }, { secret: true });
    const intoSecure = await surface.perform({ do: "fill", role: "textbox", name: "Passphrase", value: "hunter2" });

    expect(asSecret).toMatchObject({ ok: false });
    expect(intoSecure).toMatchObject({ ok: false, reason: expect.stringMatching(/sign-in tool/) });
    expect(JSON.stringify(calls)).not.toContain("hunter2");
    expect(calls.every((call) => ["list_windows", "get_window_state"].includes(call.tool))).toBe(true);
  });

  it("runs a recorded plan for other inputs and checks each step against what the fields hold", async () => {
    const shown = desktop(LEDGER());
    let clock = 0;
    const probe = createOsProbe(shown.tools, { now: () => clock });
    const dir = mkdtempSync(join(tmpdir(), "dusk-demo-os-"));
    dirs.push(dir);
    const capture = createDemoCapture({ surface: "computer", probe, screen: { frame: () => shown.tools.frame() }, frames: createFrameStore({ dir }) });
    const inputs: RawInput[] = [down(130, 192), { type: "pointer", action: "up", x: 130, y: 192, button: "left" }, ...typed("1280.00"), down(130, 362), { type: "pointer", action: "up", x: 130, y: 362, button: "left" }];
    for (const raw of inputs) {
      clock += 1_000;
      probe.note(raw);
      await capture.input(raw);
      if (raw.type === "pointer" && raw.action === "up" && raw.y === 362) shown.state.title = "Saved - Ledger";
    }
    clock += 1_000;
    const plan = await compileDemo(await capture.finish(), { engine: null });

    expect(plan.blanks.map((blank) => [blank.name, blank.kind, blank.example])).toEqual([["amount", "number", "1280.00"]]);
    expect(plan.steps.flatMap((step) => step.actions)).toEqual([{ do: "fill", role: "textbox", name: "Amount", value: "{{amount}}" }, { do: "click", role: "button", name: "Save" }]);
    expect(plan.steps.at(-1)!.check).toEqual({ kind: "text", text: "Saved - Ledger" });

    const again = desktop(LEDGER());
    const report = await runReplay({ plan, items: [{ id: "a", label: "a", values: { amount: "415.50" }, missing: [] }], surface: createOsSurface(again.tools), wait: async () => {} });
    expect(report.items[0], JSON.stringify(report.items[0])).toMatchObject({ status: "done" });
    expect(report.items[0]!.steps.every((step) => step.via === "direct" && step.attempts === 1)).toBe(true);
    expect(again.state.rows[3]!.value).toBe("415.50");
    expect(again.state.title).toBe("Saved - Ledger");
  });
});
