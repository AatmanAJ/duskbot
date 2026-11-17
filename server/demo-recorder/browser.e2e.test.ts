// A task shown once in a bot's browser on real Chrome: the person's clicks and keys go through their own view of the
// browser, as the app sends them, while the recording hears each one first. Then the task is done again for other
// receipts on a version of the page laid out differently, by the bot's side of the same browser.
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DemoPlan, DemoRecording } from "../../shared/demo-recording.ts";
import { FixtureServer } from "../browser/cdp/testing/fixtures.ts";
import { CHROME, testRoot } from "../browser/cdp/testing/real-chrome.ts";
import type { BrowserTarget } from "../browser/service.ts";
import { startService, until, type RealService } from "../browser/testing/real-service.ts";
import type { Viewer, ViewerOutput } from "../browser/viewers/core.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { browserDemoSource } from "./browser-source.ts";
import { readDemoInputs } from "./inputs.ts";
import { resvgMasker } from "./mask.ts";
import { createDemoRecorder, type DemoRecorder } from "./recorder.ts";
import { decodePng, pixelAt } from "./testing/png.ts";
import { PORTAL_HTML, receiptFiles } from "./testing/portal-page.ts";

const suite = CHROME ? describe : describe.skip;
const PASSWORD = "harbor-demo-pass";

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

suite("a task shown once in the bot's browser, on real Chrome", () => {
  let fx: FixtureServer;
  let real: RealService;
  let dir: string;
  let recorder: DemoRecorder;
  let sessions = 0;
  const logs: string[] = [];

  beforeAll(async () => {
    fx = await FixtureServer.start();
    fx.page("/portal.html", PORTAL_HTML);
    real = await startService();
    dir = mkdtempSync(join(testRoot(), "dusk-demo-e2e-"));
    recorder = createDemoRecorder({ dir, masker: resvgMasker(), log: (line) => logs.push(line), skills: { install: () => ({ name: "harbor-expense" }) } });
  }, hostTimeout(240_000));

  afterAll(async () => {
    await real?.close();
    await fx?.close();
    if (dir) await removeTempDir(dir);
  });

  /** A person's view of a fresh browser on `url`, holding control, and the tools to act through it. */
  async function person(url: string) {
    const target: BrowserTarget = { session: `demo-${++sessions}`, key: `bot:demo-${sessions}` };
    const opened = await real.call(target, "agent_browser_open", { url });
    expect(opened.isError, real.text(opened)).toBeUndefined();
    const outputs: ViewerOutput[] = [];
    const viewer: Viewer = await real.service.attachViewer(target, { owner: "local-owner", canOperate: true, maxWidth: 1280, maxHeight: 800, size: { width: 1280, height: 800 }, pagePopups: true }, (output) => {
      if (output.type === "frame") output.ack();
      else outputs.push(output);
    });
    await viewer.input({ type: "takeControl" });
    await until(() => viewer.controlState().controlling, (controlling) => controlling);
    const source = browserDemoSource({ page: () => real.service.demoPage(target.session), still: () => real.service.demoStill(target.session), act: (work) => real.service.demoAct(target, work) });
    const centerOf = async (find: string) => until(
      () => real.peek<[number, number] | null>(target, `(() => { const element = ${find}; if (!element) return null; const rect = element.getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2]; })()`),
      (at) => at !== null,
    ) as Promise<[number, number]>;
    const byLabel = (label: string) => `[...document.querySelectorAll("label")].filter((each) => each.textContent.trim() === ${JSON.stringify(label)}).map((each) => each.control)[0]`;
    const byWords = (words: string) => `[...document.querySelectorAll("button")].find((each) => each.textContent.trim() === ${JSON.stringify(words)})`;
    const click = async (find: string) => {
      const [x, y] = await centerOf(find);
      await viewer.input({ type: "mouse", action: "move", x, y, button: "none" });
      await viewer.input({ type: "mouse", action: "down", x, y, button: "left", clickCount: 1 });
      await viewer.input({ type: "mouse", action: "up", x, y, button: "left", clickCount: 1 });
    };
    return {
      target,
      source,
      viewer,
      record(botId: string): DemoRecording {
        const started = recorder.start({ botId, surface: "browser", probe: source.probe, screen: source.screen });
        if (!("id" in started)) throw new Error(started.error);
        real.service.demoTap(target.session, { input: (raw) => recorder.input(botId, raw) });
        return started;
      },
      async stop(botId: string): Promise<DemoRecording> {
        real.service.demoTap(target.session, null);
        const stopped = await recorder.stop(botId);
        if (!("id" in stopped)) throw new Error(stopped.error);
        return stopped;
      },
      field: (label: string) => click(byLabel(label)),
      press: (words: string) => click(byWords(words)),
      async type(text: string) {
        for (const key of text) {
          await viewer.input({ type: "key", action: "down", key, text: key });
          await viewer.input({ type: "key", action: "up", key });
        }
      },
      async choose(label: string, option: string) {
        const [x, y] = await centerOf(byLabel(label));
        const before = outputs.length;
        await viewer.input({ type: "mouse", action: "down", x, y, button: "left", clickCount: 1 });
        const popup = await until(() => outputs.slice(before).find((output) => output.type === "selectPopup"), (found) => found !== undefined) as Extract<ViewerOutput, { type: "selectPopup" }>;
        await viewer.input({ type: "mouse", action: "up", x, y, button: "left", clickCount: 1 });
        await viewer.input({ type: "selectChoose", id: popup.id, index: popup.options.findIndex((each) => each.label === option) });
      },
      async handBack() {
        await viewer.input({ type: "releaseControl" });
        await until(() => real.service.heldBy(target.session), (holder) => holder === null);
      },
      stored: () => real.peek<{ signedIn?: boolean; expenses?: Array<{ merchant: string; amount: number; date: string; category: string; notes: string }> }>(target, `JSON.parse(sessionStorage.getItem("harbor") || "{}")`),
    };
  }

  const onLayout = (plan: DemoPlan, url: string): DemoPlan => ({ ...plan, steps: plan.steps.map((step) => ({ ...step, actions: step.actions.map((action) => (action.do === "open" ? { ...action, url } : action)) })) });

  it("never keeps the password a person types, blacks its field out of the pictures, and signs in again from a saved sign-in", async () => {
    const me = await person(fx.url("/portal.html"));
    me.record("bot-sign-in");
    await me.field("Work email");
    await me.type("sam@harbor.test");
    await me.field("Password");
    await me.type(PASSWORD);
    const passwordBox = await real.peek<{ x: number; y: number; width: number; height: number }>(me.target, `(() => { const rect = document.querySelector("#password").getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })()`);
    await me.press("Sign in");
    await until(() => me.stored(), (stored) => stored.signedIn === true);
    const recording = await me.stop("bot-sign-in");

    expect(recording.status).toBe("ready");
    expect(recording.accessibility).toBe("dom");
    const trace = JSON.parse(readFileSync(join(dir, recording.id, "trace.json"), "utf8")) as { events: Array<{ kind: string; text?: string; secure?: boolean; chars?: number; target?: { name: string; secure: boolean } }> };
    const typed = trace.events.filter((event) => event.kind === "type");
    expect(typed.map((event) => [event.target?.name, event.text, event.secure, event.chars])).toEqual([["Work email", "sam@harbor.test", undefined, undefined], ["Password", undefined, true, PASSWORD.length]]);
    expect(recording.plan!.blanks.map((blank) => [blank.name, blank.kind])).toEqual([["work_email", "text"], ["password", "secret"]]);

    const folder = join(dir, recording.id);
    for (const file of filesUnder(folder)) {
      const bytes = readFileSync(file);
      for (const form of [Buffer.from(PASSWORD, "utf8"), Buffer.from(PASSWORD, "utf16le"), Buffer.from(Buffer.from(PASSWORD).toString("base64"))]) expect(bytes.includes(form), `${file} holds the password`).toBe(false);
    }
    expect(logs.join("\n")).not.toContain(PASSWORD);
    expect(JSON.stringify(recorder.get(recording.id))).not.toContain(PASSWORD);

    const masked = recording.frames.filter((frame) => frame.masked);
    expect(masked.length).toBeGreaterThan(0);
    for (const frame of masked) {
      const picture = decodePng(recorder.frame(recording.id, frame.id)!.data);
      const scale = frame.scale ?? 1;
      const at = (dx: number, dy: number) => pixelAt(picture, Math.round((passwordBox.x + passwordBox.width * dx) * scale), Math.round((passwordBox.y + passwordBox.height * dy) * scale));
      for (const [dx, dy] of [[0.1, 0.5], [0.5, 0.5], [0.9, 0.5]] as const) expect(at(dx, dy).every((channel) => channel <= 8), `frame ${frame.id}`).toBe(true);
    }
    const signInPictures = trace.events.length;
    expect(recording.frames.length + recording.framesSkipped).toBeGreaterThanOrEqual(Math.min(2, signInPictures));

    await me.handBack();
    await real.peek(me.target, `sessionStorage.clear()`);
    const asked: string[] = [];
    const report = await recorder.replay(recording.id, {
      items: [{ id: "sam", label: "sam", values: { work_email: "sam@harbor.test" }, missing: [] }],
      surface: me.source.surface,
      secrets: async (blank) => { asked.push(blank); return PASSWORD; },
      log: (line) => logs.push(line),
    });
    if (!("items" in report)) throw new Error(report.error);
    expect(report.items[0]!.status, JSON.stringify(report.items[0])).toBe("done");
    expect(asked).toEqual(["password"]);
    await expect(me.stored()).rejects.toThrow(/saved password is still on this page/i);
    const reopened = await real.call(me.target, "agent_browser_open", { url: fx.url("/portal.html") });
    expect(reopened.isError, real.text(reopened)).toBeUndefined();
    expect((await me.stored()).signedIn).toBe(true);
    expect(JSON.stringify(report)).not.toContain(PASSWORD);
    expect(logs.join("\n")).not.toContain(PASSWORD);
    await me.viewer.close();
  }, hostTimeout(120_000));

  it("records an expense as the person files it, then files three more on a rearranged page", async () => {
    const me = await person(`${fx.url("/portal.html")}?signedIn=1`);
    me.record("bot-expense");
    await me.press("New expense");
    await me.field("Merchant");
    await me.type("Blue Door Coffee");
    await me.field("Amount");
    await me.type("18.40");
    await me.field("Date");
    await me.type("2026-11-02");
    await me.choose("Category", "Meals");
    await me.field("Notes");
    await me.type("Team stand-up coffee");
    await me.press("Submit expense");
    await until(() => me.stored(), (stored) => stored.expenses?.length === 1);
    const recording = await me.stop("bot-expense");

    expect(recording.status).toBe("ready");
    const plan = recording.plan!;
    expect(plan.blanks.map((blank) => [blank.name, blank.kind, blank.example])).toEqual([
      ["merchant", "text", "Blue Door Coffee"], ["amount", "number", "18.40"], ["date", "date", "2026-11-02"], ["category", "choice", "Meals"], ["notes", "text", "Team stand-up coffee"],
    ]);
    expect(plan.steps.flatMap((step) => step.actions).map((action) => action.do)).toEqual(["open", "click", "fill", "fill", "fill", "choose", "fill", "click"]);
    const submit = plan.steps.at(-1)!;
    expect(submit.check).toMatchObject({ kind: "text" });
    expect((submit.check as { text: string }).text).toContain("{{merchant}}");
    for (const step of plan.steps.filter((each) => each.frame)) expect(recorder.frame(recording.id, step.frame!), step.title).toBeTruthy();
    expect(recording.frames.every((frame) => !frame.masked)).toBe(true);

    await me.handBack();
    const items = (await readDemoInputs(receiptFiles(), plan.blanks)).slice(1, 4);
    const updated = recorder.updatePlan(recording.id, onLayout(plan, `${fx.url("/portal.html")}?signedIn=1&layout=shifted`));
    expect(updated).toHaveProperty("id");
    const report = await recorder.replay(recording.id, { items, surface: me.source.surface });
    if (!("items" in report)) throw new Error(report.error);

    expect(report.done, JSON.stringify(report.items.filter((item) => item.status !== "done"))).toBe(3);
    expect(report.items.every((item) => item.steps.every((step) => step.via === "direct" && step.attempts === 1))).toBe(true);
    const filed = (await me.stored()).expenses!;
    expect(filed.slice(1).map((expense) => [expense.merchant, expense.amount, expense.date, expense.category, expense.notes])).toEqual(
      items.map((item) => [item.values.merchant, Number(item.values.amount), item.values.date, item.values.category, item.values.notes]),
    );
    await me.viewer.close();
  }, hostTimeout(180_000));

  it("refuses to act again while a person holds the browser", async () => {
    const me = await person(`${fx.url("/portal.html")}?signedIn=1`);
    const done = await me.source.surface.perform({ do: "click", role: "button", name: "New expense" });

    expect(done.ok).toBe(false);
    await me.handBack();
    expect(await me.source.surface.perform({ do: "click", role: "button", name: "New expense" })).toEqual({ ok: true });
    await me.viewer.close();
  }, hostTimeout(60_000));
});
