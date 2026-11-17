// A task shown in a browser that dusk bot's own driver does not run, reached as the older engine's browser is: over a
// DevTools socket of its own. The person's input arrives as that engine's view sends it.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DemoPlan } from "../../shared/demo-recording.ts";
import { connectCdp, type Cdp } from "../browser-sites.ts";
import { sandboxDisabled } from "../browser/chrome/host-setup.ts";
import { FixtureServer } from "../browser/cdp/testing/fixtures.ts";
import { CHROME, testRoot } from "../browser/cdp/testing/real-chrome.ts";
import { until } from "../browser/testing/real-service.ts";
import { liveDemoInputOf, type DemoTap } from "../browser/viewers/demo-tap.ts";
import { removeTempDir, waitForExit } from "../testing/cleanup.ts";
import { hostTimeout } from "../testing/host-timeout.ts";
import { createDemoCapture, type DemoCapture } from "./capture.ts";
import { compileDemo } from "./compiler.ts";
import { DevToolsPage, devToolsDemoSource } from "./devtools-page.ts";
import { createFrameStore } from "./frames.ts";
import { readDemoInputs } from "./inputs.ts";
import { liveDemoSeat } from "./live-seat.ts";
import { resvgMasker } from "./mask.ts";
import { runReplay } from "./replay.ts";
import { decodePng, pixelAt } from "./testing/png.ts";
import { PORTAL_HTML, receiptFiles } from "./testing/portal-page.ts";

const suite = CHROME ? describe : describe.skip;
const PASSWORD = "harbor-demo-pass";

suite("a task shown over a DevTools socket, on real Chrome", () => {
  let fx: FixtureServer;
  let chrome: ChildProcess;
  let profile: string;
  let frames: string;
  let cdp: Cdp;
  let address: string;
  let page: DevToolsPage;

  beforeAll(async () => {
    fx = await FixtureServer.start();
    fx.page("/portal.html", PORTAL_HTML);
    profile = mkdtempSync(join(testRoot(), "dusk-demo-devtools-"));
    frames = mkdtempSync(join(testRoot(), "dusk-demo-devtools-frames-"));
    chrome = spawn(CHROME!, [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,800",
      ...(sandboxDisabled(process.env) ? ["--no-sandbox"] : []), "about:blank",
    ], { stdio: "ignore" });
    const active = join(profile, "DevToolsActivePort");
    await until(() => existsSync(active) && readFileSync(active, "utf8").trim().split("\n").length >= 2, (ready) => ready, hostTimeout(60_000));
    const [port, path] = readFileSync(active, "utf8").trim().split("\n");
    address = `ws://127.0.0.1:${port}${path}`;
    cdp = await connectCdp(address, hostTimeout(20_000));
    page = (await DevToolsPage.open(cdp))!;
    expect(page).toBeTruthy();
  }, hostTimeout(120_000));

  afterAll(async () => {
    cdp?.close();
    await waitForExit(chrome, { signal: "SIGTERM" });
    if (profile) await removeTempDir(profile);
    if (frames) await removeTempDir(frames);
  });

  /** A person at the older view: each message goes to the recording first, then to the page as real input. */
  function person(capture: DemoCapture) {
    const tell = async (message: Record<string, unknown>) => {
      const raw = liveDemoInputOf(message);
      if (raw) await capture.input(raw);
    };
    const centerOf = async (find: string) => until(
      () => page.evaluate(`(() => { const element = ${find}; if (!element) return null; const rect = element.getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2]; })()`) as Promise<[number, number] | null>,
      (at) => at !== null,
    ) as Promise<[number, number]>;
    const click = async (find: string) => {
      const [x, y] = await centerOf(find);
      await tell({ type: "input_mouse", eventType: "mouseMoved", x, y, button: "none" });
      await tell({ type: "input_mouse", eventType: "mousePressed", x, y, button: "left", clickCount: 1 });
      await page.mouse.move(x, y);
      await page.mouse.down();
      await tell({ type: "input_mouse", eventType: "mouseReleased", x, y, button: "left", clickCount: 1 });
      await page.mouse.up();
    };
    return {
      field: (label: string) => click(`[...document.querySelectorAll("label")].filter((each) => each.textContent.trim() === ${JSON.stringify(label)}).map((each) => each.control)[0]`),
      press: (words: string) => click(`[...document.querySelectorAll("button")].find((each) => each.textContent.trim() === ${JSON.stringify(words)})`),
      async type(text: string) {
        for (const key of text) {
          await tell({ type: "input_keyboard", eventType: "keyDown", key, text: key, modifiers: 0 });
          await page.keyboard.insertText(key);
          await tell({ type: "input_keyboard", eventType: "keyUp", key, modifiers: 0 });
        }
      },
    };
  }

  const stored = () => page.evaluate(`JSON.parse(sessionStorage.getItem("harbor") || "{}")`) as Promise<{ signedIn?: boolean; expenses?: Array<{ merchant: string; amount: number; category: string }> }>;
  const source = () => devToolsDemoSource(async () => page);
  const onLayout = (plan: DemoPlan, url: string): DemoPlan => ({ ...plan, steps: plan.steps.map((step) => ({ ...step, actions: step.actions.map((action) => (action.do === "open" ? { ...action, url } : action)) })) });

  it("reads the page in a world of its own, takes its picture with its scale, and finds its way after a navigation", async () => {
    await page.navigate(fx.url("/portal.html"));
    expect(await page.url()).toBe(fx.url("/portal.html"));
    expect(await page.evaluate("typeof window.harbor")).toBe("undefined");
    const shot = (await page.still())!;
    expect(shot.type).toBe("image/jpeg");
    expect(shot.width).toBeGreaterThan(300);
    expect(shot.scale).toBeGreaterThan(0);
    const probe = source().probe;
    expect(await probe.context()).toMatchObject({ url: fx.url("/portal.html"), title: "Sign in · Harbor Expenses" });
    expect((await probe.secureRegions())!.length).toBe(1);
    await page.navigate(`${fx.url("/portal.html")}?signedIn=1`);
    expect(await probe.texts!()).toEqual(["Expenses"]);
  }, hostTimeout(60_000));

  it("never keeps the password, and blacks its field out of the pictures at the picture's own scale", async () => {
    await page.evaluate("sessionStorage.clear()");
    await page.navigate(fx.url("/portal.html"));
    const { probe, screen } = source();
    const capture = createDemoCapture({ surface: "browser", probe, screen, frames: createFrameStore({ dir: join(frames, "sign-in"), masker: resvgMasker() }) });
    const me = person(capture);
    await me.field("Work email");
    await me.type("sam@harbor.test");
    await me.field("Password");
    await me.type(PASSWORD);
    const box = await page.evaluate(`(() => { const rect = document.querySelector("#password").getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })()`) as { x: number; y: number; width: number; height: number };
    await me.press("Sign in");
    await until(stored, (now) => now.signedIn === true);
    const trace = await capture.finish();

    const typed = trace.events.filter((event) => event.kind === "type");
    expect(typed.map((event) => [event.target?.name, event.text, event.secure, event.chars])).toEqual([["Work email", "sam@harbor.test", undefined, undefined], ["Password", undefined, true, PASSWORD.length]]);
    expect(JSON.stringify(trace)).not.toContain(PASSWORD);
    const masked = trace.frames.filter((frame) => frame.masked);
    expect(masked.length).toBeGreaterThan(0);
    for (const frame of masked) {
      const picture = decodePng(readFileSync(join(frames, "sign-in", `${frame.id}.png`)));
      const scale = frame.scale ?? 1;
      for (const dx of [0.1, 0.5, 0.9]) {
        const color = pixelAt(picture, Math.round((box.x + box.width * dx) * scale), Math.round((box.y + box.height / 2) * scale));
        expect(color.every((channel) => channel <= 8), `frame ${frame.id} at ${dx}`).toBe(true);
      }
    }
  }, hostTimeout(90_000));

  it("records an expense and files three more on a rearranged page", async () => {
    await page.evaluate("sessionStorage.clear()");
    await page.navigate(`${fx.url("/portal.html")}?signedIn=1`);
    const { probe, screen, surface } = source();
    const capture = createDemoCapture({ surface: "browser", probe, screen, frames: createFrameStore({ dir: join(frames, "expense"), masker: resvgMasker() }) });
    const me = person(capture);
    await me.press("New expense");
    await me.field("Merchant");
    await me.type("Blue Door Coffee");
    await me.field("Amount");
    await me.type("18.40");
    await me.field("Date");
    await me.type("2026-11-02");
    await me.field("Notes");
    await me.type("Team stand-up coffee");
    await me.press("Submit expense");
    await until(stored, (now) => now.expenses?.length === 1);
    const plan = await compileDemo(await capture.finish(), { engine: null });

    expect(plan.blanks.map((blank) => blank.name)).toEqual(["merchant", "amount", "date", "notes"]);
    expect(plan.steps.flatMap((step) => step.actions).map((action) => action.do)).toEqual(["open", "click", "fill", "fill", "fill", "fill", "click"]);
    const items = (await readDemoInputs(receiptFiles(), plan.blanks)).slice(1, 4);
    const report = await runReplay({ plan: onLayout(plan, `${fx.url("/portal.html")}?signedIn=1&layout=shifted`), items, surface });

    expect(report.done, JSON.stringify(report.items.filter((item) => item.status !== "done"))).toBe(3);
    expect(report.items.every((item) => item.steps.every((step) => step.via === "direct" && step.attempts === 1))).toBe(true);
    const filed = (await stored()).expenses!;
    expect(filed.slice(1).map((expense) => [expense.merchant, expense.amount])).toEqual(items.map((item) => [item.values.merchant, Number(item.values.amount)]));
  }, hostTimeout(120_000));

  it("is the seat a task is shown at in the older engine's browser: its tap, its page, its gate, and letting go", async () => {
    await page.navigate(`${fx.url("/portal.html")}?signedIn=1`);
    const taps = new Map<string, DemoTap>();
    let opened = 0;
    let closed = 0;
    let gated = 0;
    let held = false;
    const seat = liveDemoSeat({
      demoTaps: taps,
      demoCdp: async (session) => {
        if (session !== "bot-1") return null;
        opened++;
        const own = await connectCdp(address, hostTimeout(20_000));
        return { cdp: { send: own.send.bind(own), close: () => { closed++; own.close(); } }, url: () => `${fx.url("/portal.html")}?signedIn=1` };
      },
      demoShared: async (_session, work) => {
        gated++;
        if (held) throw new Error("Another person controls this browser.");
        return work();
      },
    }, "bot-1");
    const tap: DemoTap = { input: async () => {} };
    seat.tap(tap);
    expect(taps.get("bot-1")).toBe(tap);

    expect(await seat.probe.context()).toMatchObject({ title: "Expenses · Harbor Expenses" });
    expect((await seat.screen.frame())!.type).toBe("image/jpeg");
    expect(seat.where()).toBe(`${fx.url("/portal.html")}?signedIn=1`);
    expect(opened).toBe(1);
    expect(gated).toBe(0);

    held = true;
    expect(await seat.surface.perform({ do: "click", role: "button", name: "New expense" })).toEqual({ ok: false, reason: "Another person controls this browser." });
    held = false;
    expect(await seat.surface.perform({ do: "click", role: "button", name: "New expense" })).toEqual({ ok: true });
    expect(gated).toBe(2);
    expect((await seat.surface.observe()).texts).toContain("New expense");

    seat.close!();
    expect(closed).toBe(1);
    expect(taps.has("bot-1")).toBe(false);
    const nobody = liveDemoSeat({ demoTaps: taps, demoCdp: async () => null, demoShared: (_session, work) => work() }, "bot-2");
    await expect(nobody.probe.context()).rejects.toThrow(/Open this bot's browser first/);
  }, hostTimeout(60_000));
});

describe("the older view's messages, as a recording reads them", () => {
  it("turns its mouse and key events into what the person did", () => {
    expect(liveDemoInputOf({ type: "input_mouse", eventType: "mousePressed", x: 10, y: 20, button: "left", clickCount: 2, modifiers: 0 })).toEqual({ type: "pointer", action: "down", x: 10, y: 20, button: "left", clickCount: 2 });
    expect(liveDemoInputOf({ type: "input_mouse", eventType: "mouseReleased", x: 10, y: 20, button: "right", clickCount: 1 })).toEqual({ type: "pointer", action: "up", x: 10, y: 20, button: "right", clickCount: 1 });
    expect(liveDemoInputOf({ type: "input_mouse", eventType: "mouseMoved", x: 11, y: 21, button: "none" })).toEqual({ type: "pointer", action: "move", x: 11, y: 21 });
    expect(liveDemoInputOf({ type: "input_mouse", eventType: "mouseWheel", x: 5, y: 6, deltaX: 0, deltaY: 240 })).toEqual({ type: "wheel", x: 5, y: 6, deltaX: 0, deltaY: 240 });
    expect(liveDemoInputOf({ type: "input_keyboard", eventType: "keyDown", key: "a", text: "a", modifiers: 0 })).toEqual({ type: "key", action: "down", key: "a", text: "a" });
    expect(liveDemoInputOf({ type: "input_keyboard", eventType: "keyDown", key: "s", modifiers: 2 })).toEqual({ type: "key", action: "down", key: "s", modifiers: 2 });
    expect(liveDemoInputOf({ type: "input_keyboard", eventType: "keyUp", key: "a" })).toEqual({ type: "key", action: "up", key: "a" });
    expect(liveDemoInputOf({ type: "input_keyboard", eventType: "char", text: "pasted words" })).toEqual({ type: "text", text: "pasted words" });
  });

  it("makes nothing of what is not input", () => {
    for (const message of [{ type: "input_mouse", eventType: "mousePressed", x: 1, y: 1, button: "none" }, { type: "input_keyboard", eventType: "keyDown" }, { type: "input_keyboard", eventType: "char" }, { type: "resize" }]) {
      expect(liveDemoInputOf(message)).toBeNull();
    }
  });
});
