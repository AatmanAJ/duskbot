// Nothing a person types into a secure field may reach the disk, a log, the skill, the routine or the model, and no
// picture may show such a field. Every test here types a known secret and then looks for it everywhere.
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { DemoRect, DemoReplayProgress, DemoTarget } from "../../../shared/demo-recording.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { createDemoCapture, type AccessibilityProbe, type RawInput, type ScreenSource } from "../capture.ts";
import { createFrameStore, type ImageMasker, type ScreenFrame } from "../frames.ts";
import { resvgMasker } from "../mask.ts";
import { createDemoRecorder } from "../recorder.ts";
import { blankPicture, decodePng, encodePng, fillRect, pixelAt, type Rgb } from "../testing/png.ts";
import { openPortal, showOneExpense } from "../testing/portal-page.ts";

const SECRET = "harbor-demo-pass";
const HERE = dirname(fileURLToPath(import.meta.url));

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dusk-demo-secrets-"));
  dirs.push(dir);
  return dir;
}

/** Every way the secret could sit in bytes: as text in two encodings, base64, hex, or backwards. */
function forms(secret: string): Buffer[] {
  return [
    Buffer.from(secret, "utf8"),
    Buffer.from(secret, "utf16le"),
    Buffer.from(Buffer.from(secret, "utf8").toString("base64").replace(/=+$/, ""), "utf8"),
    Buffer.from(Buffer.from(secret, "utf8").toString("hex"), "utf8"),
    Buffer.from([...secret].reverse().join(""), "utf8"),
  ];
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function expectNoSecretOnDisk(dir: string, secret = SECRET): void {
  const files = filesUnder(dir);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const bytes = readFileSync(file);
    for (const form of forms(secret)) expect(bytes.includes(form), `${file} holds the secret`).toBe(false);
  }
}

function expectNoSecretIn(value: unknown, where: string, secret = SECRET): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const form of forms(secret)) expect(text.includes(form.toString("utf8")), `${where} holds the secret`).toBe(false);
}

const plain = (name: string): DemoTarget => ({ role: "textbox", name, secure: false, bounds: { x: 8, y: 30, width: 40, height: 10 } });
const secure = (name: string): DemoTarget => ({ role: "textbox", name, secure: true, bounds: { x: 8, y: 8, width: 24, height: 12 } });
const keys = (text: string): RawInput[] => [...text].flatMap((key): RawInput[] => [{ type: "key", action: "down", key, text: key }, { type: "key", action: "up", key }]);

const BLUE: Rgb = [40, 60, 200];
const RED: Rgb = [220, 30, 30];
const GREEN: Rgb = [30, 200, 60];
const SECRET_BOX: DemoRect = { x: 8, y: 8, width: 24, height: 12 };

/** A 64x48 screen: blue, with a red box where a secure field shows what was typed, and a green box elsewhere. */
function screenPng(): ScreenFrame {
  const picture = blankPicture(64, 48, BLUE);
  fillRect(picture, SECRET_BOX, RED);
  fillRect(picture, { x: 40, y: 30, width: 16, height: 12 }, GREEN);
  return { data: encodePng(picture), type: "image/png", width: 64, height: 48 };
}

function screenJpeg(): ScreenFrame {
  return { data: readFileSync(join(HERE, "..", "fixtures", "screen-64x48.jpg")), type: "image/jpeg", width: 64, height: 48 };
}

const near = (actual: Rgb, expected: Rgb, slack = 40) => actual.every((channel, index) => Math.abs(channel - expected[index]!) <= slack);
const isBlack = (color: Rgb) => color.every((channel) => channel <= 8);

function probeOf(state: { focus: DemoTarget | null; secure: DemoRect[] | null }, kind: AccessibilityProbe["kind"] = "dom"): AccessibilityProbe {
  return {
    kind,
    at: async () => state.focus,
    focused: async () => state.focus,
    secureRegions: async () => state.secure,
    context: async () => ({ title: "Sign in", url: "http://127.0.0.1:4173/portal.html" }),
  };
}

const still: ScreenSource = { frame: async () => screenPng() };

describe("what a person types into a secure field", () => {
  it("is counted and never kept", async () => {
    const state = { focus: secure("Password"), secure: [SECRET_BOX] as DemoRect[] | null };
    const dir = tempDir();
    const logs: string[] = [];
    const capture = createDemoCapture({ surface: "browser", probe: probeOf(state), screen: still, frames: createFrameStore({ dir, masker: resvgMasker() }), log: (line) => logs.push(line) });
    for (const input of keys(SECRET)) await capture.input(input);
    const trace = await capture.finish();

    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({ kind: "type", secure: true, chars: SECRET.length, target: { name: "Password", secure: true } });
    expect(trace.events[0]!.text).toBeUndefined();
    expectNoSecretIn(trace, "the trace");
    expectNoSecretIn(logs, "the log");
    expectNoSecretOnDisk(dir);
  });

  it("is not kept when it was pasted", async () => {
    const state = { focus: secure("API key"), secure: [SECRET_BOX] as DemoRect[] | null };
    const capture = createDemoCapture({ surface: "browser", probe: probeOf(state), screen: still, frames: createFrameStore({ dir: tempDir(), masker: resvgMasker() }) });
    await capture.input({ type: "text", text: SECRET });
    const trace = await capture.finish();

    expect(trace.events[0]).toMatchObject({ kind: "type", secure: true, chars: SECRET.length });
    expectNoSecretIn(trace, "the trace");
  });

  it("is not kept when focus moved into the secure field by itself", async () => {
    const state = { focus: plain("Work email") as DemoTarget | null, secure: [SECRET_BOX] as DemoRect[] | null };
    const capture = createDemoCapture({ surface: "browser", probe: probeOf(state), screen: still, frames: createFrameStore({ dir: tempDir(), masker: resvgMasker() }) });
    for (const input of keys("sam")) await capture.input(input);
    state.focus = secure("Password");
    for (const input of keys(SECRET)) await capture.input(input);
    const trace = await capture.finish();

    const typed = trace.events.filter((event) => event.kind === "type");
    expect(typed).toHaveLength(2);
    expect(typed[0]).toMatchObject({ text: "sam", target: { name: "Work email" } });
    expect(typed[1]).toMatchObject({ secure: true, chars: SECRET.length });
    expectNoSecretIn(trace, "the trace");
  });

  it("is not kept when nothing has focus or the field cannot be read", async () => {
    for (const focused of [async () => null, async () => { throw new Error("the page went away"); }]) {
      const probe: AccessibilityProbe = { ...probeOf({ focus: null, secure: [] }), focused };
      const logs: string[] = [];
      const capture = createDemoCapture({ surface: "browser", probe, screen: still, frames: createFrameStore({ dir: tempDir(), masker: resvgMasker() }), log: (line) => logs.push(line) });
      for (const input of keys(SECRET)) await capture.input(input);
      const trace = await capture.finish();

      expect(trace.events[0]).toMatchObject({ kind: "type", secure: true, chars: SECRET.length });
      expectNoSecretIn(trace, "the trace");
      expectNoSecretIn(logs, "the log");
    }
  });

  it("is not kept when the answer about the field came after the keys that could have moved focus", async () => {
    let answer!: (target: DemoTarget | null) => void;
    const asked = new Promise<DemoTarget | null>((resolve) => { answer = resolve; });
    const probe: AccessibilityProbe = { ...probeOf({ focus: null, secure: [] }, "os"), focused: () => asked };
    const capture = createDemoCapture({ surface: "computer", probe, screen: still, frames: createFrameStore({ dir: tempDir(), masker: resvgMasker() }) });
    const pending = [...keys(SECRET), { type: "key", action: "down", key: "Tab" } as RawInput].map((input) => capture.input(input));
    answer(plain("Notes"));
    await Promise.all(pending);
    const trace = await capture.finish();

    const typed = trace.events.find((event) => event.kind === "type")!;
    expect(typed).toMatchObject({ secure: true, chars: SECRET.length });
    expect(typed.text).toBeUndefined();
    expectNoSecretIn(trace, "the trace");
  });

  it("is kept on a desktop only when the field was known to be plain while it was typed", async () => {
    const probe = probeOf({ focus: plain("Notes"), secure: [] }, "os");
    const capture = createDemoCapture({ surface: "computer", probe, screen: still, frames: createFrameStore({ dir: tempDir(), masker: resvgMasker() }) });
    for (const input of [...keys("Team lunch"), { type: "key", action: "down", key: "Tab" } as RawInput]) await capture.input(input);
    const trace = await capture.finish();

    expect(trace.events.find((event) => event.kind === "type")).toMatchObject({ text: "Team lunch", target: { name: "Notes" } });
  });

  it("is dropped on a desktop when a later look finds a secure field under the same run of keys", async () => {
    const state = { focus: plain("Notes") as DemoTarget | null, secure: [] as DemoRect[] | null };
    let now = 0;
    const capture = createDemoCapture({ surface: "computer", probe: probeOf(state, "os"), screen: still, frames: createFrameStore({ dir: tempDir(), masker: resvgMasker() }), now: () => now });
    for (const input of keys("abc")) { now += 100; await capture.input(input); }
    state.focus = secure("Password");
    for (const input of keys(SECRET)) { now += 400; await capture.input(input); }
    const trace = await capture.finish();

    expectNoSecretIn(trace, "the trace");
    const typed = trace.events.filter((event) => event.kind === "type");
    expect(typed.length).toBeGreaterThan(0);
    expect(typed.every((event) => event.text === undefined && event.secure === true)).toBe(true);
    expect(typed.reduce((sum, event) => sum + (event.chars ?? 0), 0)).toBe(3 + SECRET.length);
  });

  it("is taken out of plain fields too when it is a saved secret", async () => {
    const state = { focus: plain("Notes"), secure: [] as DemoRect[] | null };
    const capture = createDemoCapture({ surface: "browser", probe: probeOf(state), screen: still, frames: createFrameStore({ dir: tempDir() }), scrub: (text) => text.replaceAll(SECRET, "••••••") });
    for (const input of keys(`my password is ${SECRET}`)) await capture.input(input);
    const trace = await capture.finish();

    expect(trace.events[0]!.text).toBe("my password is ••••••");
    expectNoSecretIn(trace, "the trace");
  });
});

describe("pictures of a screen with a secure field", () => {
  it("are kept with the field blacked out, from a PNG", async () => {
    const dir = tempDir();
    const frames = createFrameStore({ dir, masker: resvgMasker() });
    const kept = await frames.put(screenPng(), [SECRET_BOX], "dom");

    expect(kept).toMatchObject({ masked: true, width: 64, height: 48, type: "image/png" });
    const stored = frames.read(kept!.id)!;
    const picture = decodePng(stored.data);
    expect([picture.width, picture.height]).toEqual([64, 48]);
    for (const [x, y] of [[9, 9], [20, 14], [30, 18]] as const) expect(isBlack(pixelAt(picture, x, y)), `pixel ${x},${y}`).toBe(true);
    expect(near(pixelAt(picture, 48, 36), GREEN)).toBe(true);
    expect(near(pixelAt(picture, 60, 4), BLUE)).toBe(true);
    for (const file of filesUnder(dir)) {
      const onDisk = readFileSync(file);
      if (!onDisk.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) continue;
      expect(isBlack(pixelAt(decodePng(onDisk), 20, 14)), `${file} shows the field`).toBe(true);
    }
  });

  it("are kept with the field blacked out, from a JPEG", async () => {
    const frames = createFrameStore({ dir: tempDir(), masker: resvgMasker() });
    const kept = await frames.put(screenJpeg(), [SECRET_BOX], "dom");

    expect(kept).toMatchObject({ masked: true, type: "image/png" });
    const picture = decodePng(frames.read(kept!.id)!.data);
    expect(isBlack(pixelAt(picture, 20, 14))).toBe(true);
    expect(near(pixelAt(picture, 48, 36), GREEN, 60)).toBe(true);
  });

  it("are kept as they are when no secure field is on them", async () => {
    const frames = createFrameStore({ dir: tempDir(), masker: resvgMasker() });
    const frame = screenPng();
    const kept = await frames.put(frame, [], "dom");

    expect(kept).toMatchObject({ masked: false, type: "image/png" });
    expect(frames.read(kept!.id)!.data.equals(frame.data)).toBe(true);
  });

  it("are not kept at all when the fields on them could not be read", async () => {
    const dir = tempDir();
    const frames = createFrameStore({ dir, masker: resvgMasker() });
    for (const kind of ["dom", "os"] as const) expect(await frames.put(screenPng(), null, kind)).toBeNull();

    expect(frames.skipped).toBe(2);
    expect(frames.list()).toEqual([]);
    expect(filesUnder(dir)).toEqual([]);
  });

  it("are not kept at all when the blacking out fails", async () => {
    const dir = tempDir();
    const broken: ImageMasker = { mask: async () => { throw new Error("no renderer on this computer"); } };
    const frames = createFrameStore({ dir, masker: broken });

    expect(await frames.put(screenPng(), [SECRET_BOX], "dom")).toBeNull();
    expect(frames.skipped).toBe(1);
    expect(filesUnder(dir)).toEqual([]);
  });

  it("are not kept when there is nothing to black them out with", async () => {
    const dir = tempDir();
    const frames = createFrameStore({ dir });

    expect(await frames.put(screenPng(), [SECRET_BOX], "dom")).toBeNull();
    expect(filesUnder(dir)).toEqual([]);
  });

  it("reach a recording masked, with the count of those left out", async () => {
    const state = { focus: secure("Password") as DemoTarget | null, secure: [SECRET_BOX] as DemoRect[] | null };
    const dir = tempDir();
    const capture = createDemoCapture({ surface: "browser", probe: probeOf(state), screen: still, frames: createFrameStore({ dir, masker: resvgMasker() }) });
    await capture.input({ type: "pointer", action: "down", x: 20, y: 14, button: "left" });
    await capture.input({ type: "pointer", action: "up", x: 20, y: 14, button: "left" });
    state.secure = null;
    for (const input of keys(SECRET)) await capture.input(input);
    const trace = await capture.finish();

    expect(trace.frames.length).toBeGreaterThan(0);
    expect(trace.frames.every((frame) => frame.masked)).toBe(true);
    expect(trace.framesSkipped).toBeGreaterThan(0);
    for (const file of filesUnder(dir).filter((path) => path.endsWith(".png"))) expect(isBlack(pixelAt(decodePng(readFileSync(file)), 20, 14))).toBe(true);
  });
});

describe("a whole demonstration with a sign-in", () => {
  it("leaves the password out of the disk, the log, the model, the skill, the routine and the replay", async () => {
    const dir = tempDir();
    const logs: string[] = [];
    const prompts: string[] = [];
    const installed: Array<{ path: string; content: string }> = [];
    const routines: Array<{ name: string; prompt: string; botId: string }> = [];
    const recorder = createDemoRecorder({
      dir,
      log: (line) => logs.push(line),
      masker: resvgMasker(),
      engine: () => ({ generateText: async (prompt) => { prompts.push(prompt); return "I could not make a plan."; } }),
      skills: { install: (_botId, _source, files) => { installed.push(...files); return { name: "file-an-expense" }; } },
      routines: { create: (input) => { routines.push(input); return { id: "routine-1" }; } },
    });

    const page = await openPortal("standard", { signedIn: false });
    const started = recorder.start({ botId: "bot-1", surface: "browser", probe: page.probe, screen: page.screen });
    expect("error" in started).toBe(false);
    const person = page.person({ input: (raw) => recorder.input("bot-1", raw) });
    await person.click("Work email");
    await person.type("sam@harbor.test");
    await person.click("Password");
    await person.type(SECRET);
    await person.click("Sign in");
    await showOneExpense(person);
    expect(page.expenses()).toHaveLength(1);

    const stopped = await recorder.stop("bot-1");
    if ("error" in stopped) throw new Error(stopped.error);
    expect(stopped.status).toBe("ready");
    expect(prompts).toHaveLength(1);
    const secretBlank = stopped.plan!.blanks.find((blank) => blank.kind === "secret");
    expect(secretBlank).toBeTruthy();
    expect(secretBlank!.example).toBeUndefined();

    const skilled = recorder.saveSkill(stopped.id);
    expect("error" in skilled).toBe(false);
    const routined = recorder.saveRoutine(stopped.id, { source: "the receipts folder" });
    expect("error" in routined).toBe(false);
    expect(installed.some((file) => file.path === "SKILL.md")).toBe(true);
    expect(routines).toHaveLength(1);

    const again = await openPortal("standard", { signedIn: false });
    const progress: DemoReplayProgress[] = [];
    const asked: string[] = [];
    const report = await recorder.replay(stopped.id, {
      items: [{ id: "one", label: "one", values: { work_email: "sam@harbor.test", merchant: "Lumen Rail", amount: "64.00", date: "2026-11-03", category: "Travel", notes: "Train" }, missing: [] }],
      surface: again.surface,
      secrets: async (blank) => { asked.push(blank); return SECRET; },
      onProgress: (event) => progress.push(event),
      log: (line) => logs.push(line),
      wait: async () => {},
    });
    if ("error" in report) throw new Error(report.error);
    expect(asked).toEqual([secretBlank!.name]);
    expect(report.items[0]!.status, JSON.stringify(report.items[0])).toBe("done");
    expect(again.window.eval("window.harbor.state.signedIn")).toBe(true);
    expect(again.expenses().map((expense) => expense.merchant)).toContain("Lumen Rail");

    expectNoSecretOnDisk(dir);
    expectNoSecretIn(logs, "the log");
    expectNoSecretIn(prompts, "what the model was asked");
    expectNoSecretIn(installed, "the skill");
    expectNoSecretIn(routines, "the routine");
    expectNoSecretIn(recorder.list(), "the recordings the app is sent");
    expectNoSecretIn(recorder.get(stopped.id), "the recording the app is sent");
    expectNoSecretIn(progress, "the replay's progress");
    expectNoSecretIn(report, "the replay's report");
    await page.close();
    await again.close();
  });
});
