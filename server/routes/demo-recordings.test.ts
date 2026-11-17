// The routes a person's app uses to show a bot a task and have it done again, over real HTTP, with the fake expense
// portal standing in for the bot's browser.
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dayText, renameBlank, setBlankToday } from "../../shared/demo-plan.ts";
import type { DemoChange, DemoPlan, DemoRecording, DemoReplayItem, DemoReplayRun } from "../../shared/demo-recording.ts";
import type { DemoTap } from "../browser/viewers/demo-tap.ts";
import { createDemoHost, type DemoSeat } from "../demo-recorder/host.ts";
import { createDemoRecorder } from "../demo-recorder/recorder.ts";
import { openPortal, receiptFiles, showOneExpense, type PortalPage } from "../demo-recorder/testing/portal-page.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { createDemoRecordingRoutes } from "./demo-recordings.ts";
import { dispatchRoutes } from "./table.ts";

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const step of cleanup.splice(0).reverse()) await step(); });

async function serve(options: { turn?: (text: string) => Promise<string>; guest?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dusk-demo-routes-"));
  cleanup.push(() => removeTempDir(dir));
  const page: PortalPage = await openPortal("standard");
  cleanup.push(() => page.close());
  const changes: DemoChange[] = [];
  const installed: Array<{ botId: string; content: string }> = [];
  const routines: Array<{ name: string; prompt: string; botId: string }> = [];
  let tap: DemoTap | null = null;
  const recorder = createDemoRecorder({
    dir,
    skills: { install: (botId, _source, files) => { installed.push({ botId, content: files[0]!.content }); return { name: /^name: (.+)$/m.exec(files[0]!.content)![1]! }; } },
    routines: { create: (input) => { routines.push(input); return { id: "routine-9" }; } },
    onChange: (recording) => changes.push({ botId: recording.botId, recording }),
  });
  const seat: DemoSeat = { probe: page.probe, screen: page.screen, surface: page.surface, tap: (next) => { tap = next; }, where: () => page.url() };
  const host = createDemoHost<RequestAuth>({
    recorder,
    browser: async (botId) => (botId === "bot-1" ? seat : { status: 409, error: "This bot's browser is off." }),
    computer: async () => ({ status: 409, error: "This test shows tasks in the browser." }),
    engine: () => null,
    ...(options.turn ? { turn: (_botId, _threadId, text) => options.turn!(text) } : {}),
    changed: (change) => changes.push(change),
  });
  const routes = [createDemoRecordingRoutes({ host, recorder, botExists: (id) => id.startsWith("bot-"), surfaces: async () => ({ browser: true, computer: false }), changed: (change) => changes.push(change) })];
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = (options.guest ? { kind: "session", scopes: ["client"] } : { kind: "loopback", scopes: ["admin"] }) as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "no route" });
  });
  cleanup.push(() => new Promise((done) => server.close(done)));
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const response = await fetch(`${base}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as T };
  };
  return { base, call, page, changes, installed, routines, person: () => page.person({ input: async (raw) => tap?.input(raw) }), tapped: () => tap !== null };
}

/** Shows one expense through the routes and returns the recording as it stops. */
async function recorded(on: Awaited<ReturnType<typeof serve>>): Promise<DemoRecording> {
  const started = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos", { surface: "browser", threadId: "thread-1" });
  expect(started.status).toBe(201);
  await showOneExpense(on.person());
  const stopped = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos/stop");
  expect(stopped.status).toBe(200);
  return stopped.body.recording;
}

async function finished(on: Awaited<ReturnType<typeof serve>>, id: string): Promise<DemoReplayRun> {
  for (let tries = 0; tries < 400; tries++) {
    const { body } = await on.call<{ run: DemoReplayRun | null }>("GET", `/api/demos/${id}/replay`);
    if (body.run && body.run.status !== "running") return body.run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("the replay did not finish");
}

describe("showing a bot a task over the routes", () => {
  it("starts, hears the person's input, and stops into steps", async () => {
    const on = await serve();
    const before = await on.call<{ recordings: DemoRecording[]; recording: boolean; surfaces: { browser: boolean; computer: boolean } }>("GET", "/api/bots/bot-1/demos");
    expect(before.body).toEqual({ recordings: [], recording: false, surfaces: { browser: true, computer: false } });

    const started = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos", { surface: "browser", threadId: "thread-1" });
    expect(started.status).toBe(201);
    expect(started.body.recording).toMatchObject({ botId: "bot-1", status: "recording", surface: "browser", threadId: "thread-1" });
    expect(on.tapped()).toBe(true);
    expect((await on.call("POST", "/api/bots/bot-1/demos", { surface: "browser" })).status).toBe(409);
    expect((await on.call<{ recording: boolean }>("GET", "/api/bots/bot-1/demos")).body.recording).toBe(true);

    await showOneExpense(on.person());
    const stopped = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos/stop");
    expect(stopped.body.recording.status).toBe("ready");
    expect(stopped.body.recording.plan!.blanks.map((blank) => blank.name)).toEqual(["merchant", "amount", "date", "category", "notes"]);
    expect(on.tapped()).toBe(false);
    expect(on.changes.some((change) => change.recording?.status === "compiling")).toBe(true);
    expect((await on.call("POST", "/api/bots/bot-1/demos/stop")).status).toBe(409);
  });

  it("refuses a bot that is not there, a screen it cannot be shown on, and a body that names neither", async () => {
    const on = await serve();

    expect((await on.call("POST", "/api/bots/nobody/demos", { surface: "browser" })).status).toBe(404);
    expect((await on.call<{ error: string }>("POST", "/api/bots/bot-1/demos", { surface: "computer" })).body.error).toBe("This test shows tasks in the browser.");
    expect((await on.call("POST", "/api/bots/bot-2/demos", { surface: "browser" })).status).toBe(409);
    expect((await on.call("POST", "/api/bots/bot-1/demos", { surface: "phone" })).status).toBe(400);
    expect((await on.call("GET", "/api/demos/demo-00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("throws a recording away when it is cancelled", async () => {
    const on = await serve();
    const started = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos", { surface: "browser" });
    await on.person().click("New expense");

    expect((await on.call("POST", "/api/bots/bot-1/demos/cancel")).status).toBe(200);
    expect(on.tapped()).toBe(false);
    expect((await on.call<{ recordings: DemoRecording[] }>("GET", "/api/bots/bot-1/demos")).body.recordings).toEqual([]);
    expect(on.changes.at(-1)).toEqual({ botId: "bot-1", removed: started.body.recording.id });
  });

  it("serves a step's picture privately and nothing outside the recording", async () => {
    const on = await serve();
    const recording = await recorded(on);
    const step = recording.plan!.steps.find((each) => each.frame)!;
    const picture = await fetch(`${on.base}/api/demos/${recording.id}/frames/${step.frame}`);

    expect(picture.status).toBe(200);
    expect(picture.headers.get("content-type")).toBe("image/png");
    expect(picture.headers.get("cache-control")).toBe("private, no-store");
    expect(picture.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await picture.arrayBuffer()).subarray(1, 4).toString("ascii")).toBe("PNG");
    expect((await fetch(`${on.base}/api/demos/${recording.id}/frames/f${"0".repeat(20)}`)).status).toBe(404);
    expect((await fetch(`${on.base}/api/demos/${recording.id}/frames/..%2Frecording.json`)).status).toBe(404);
  });

  it("takes an edited plan, saves it as a skill and as a routine", async () => {
    const on = await serve();
    const recording = await recorded(on);
    const edited = renameBlank(recording.plan!, "merchant", "vendor") as DemoPlan;
    const saved = await on.call<{ recording: DemoRecording }>("PUT", `/api/demos/${recording.id}/plan`, { plan: { ...edited, title: "File a Harbor expense" } });
    expect(saved.status).toBe(200);
    expect(saved.body.recording.plan!.blanks[0]!.name).toBe("vendor");
    expect((await on.call("PUT", `/api/demos/${recording.id}/plan`, { plan: { title: "no steps" } })).status).toBe(422);

    const skilled = await on.call<{ recording: DemoRecording }>("POST", `/api/demos/${recording.id}/skill`, { name: "Harbor expense" });
    expect(skilled.status).toBe(201);
    expect(skilled.body.recording.skillName).toBe("harbor-expense");
    expect(on.installed[0]!.content).toContain("{{vendor}}");

    const routined = await on.call<{ recording: DemoRecording }>("POST", `/api/demos/${recording.id}/routine`, { name: "Friday receipts", source: "the files in ~/Receipts/new" });
    expect(routined.status).toBe(201);
    expect(routined.body.recording.routineId).toBe("routine-9");
    expect(on.routines[0]).toMatchObject({ name: "Friday receipts", botId: "bot-1" });
    expect((await on.call("POST", `/api/demos/${recording.id}/routine`, { name: "No source" })).status).toBe(400);
  });

  it("makes one routine for a task, and refuses a second", async () => {
    const on = await serve();
    const recording = await recorded(on);
    expect((await on.call("POST", `/api/demos/${recording.id}/routine`, { source: "the files in ~/Receipts/new" })).status).toBe(201);

    const again = await on.call<{ error?: string }>("POST", `/api/demos/${recording.id}/routine`, { source: "the files in ~/Receipts/new" });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(again.body)).toContain("already has a routine");
    expect(on.routines).toHaveLength(1);
  });

  it("does the task again for a folder of files and reports each as it goes", async () => {
    const on = await serve();
    const recording = await recorded(on);
    const files = receiptFiles().slice(1);
    const begun = await on.call<{ run: DemoReplayRun }>("POST", `/api/demos/${recording.id}/replay`, { files });

    expect(begun.status).toBe(202);
    expect(begun.body.run.items.map((item) => item.label)).toEqual(files.map((file) => file.name));
    expect(begun.body.run.status).toBe("running");
    const run = await finished(on, recording.id);
    expect(run).toMatchObject({ status: "done", done: 11, failed: 0 });
    expect(run.items.every((item) => item.status === "done" && item.byBot === 0)).toBe(true);
    expect(on.page.expenses().slice(1).map((expense) => expense.merchant)).toEqual(files.map((file) => run.items.find((item) => item.label === file.name)!.values.merchant));
    const seen = on.changes.flatMap((change) => (change.run ? [change.run] : []));
    expect(seen.some((each) => each.items.some((item) => item.status === "running" && item.step))).toBe(true);
    expect(seen.at(-1)!.status).toBe("done");
  });

  it("marks a file it could not read inputs from, and one whose task failed with what the screen said", async () => {
    const on = await serve();
    const recording = await recorded(on);
    const files = [
      { name: "scrap.txt", content: "Amount: 9.00\n" },
      { name: "bad-date.txt", content: "Merchant: Corner Deli\nAmount: 9.00\nDate: yesterday\nCategory: Meals\nNotes: Lunch\n" },
      receiptFiles()[2]!,
    ];
    await on.call("POST", `/api/demos/${recording.id}/replay`, { files });
    const run = await finished(on, recording.id);

    expect(run.items.map((item) => [item.status, item.note ?? ""])).toEqual([["skipped", ""], ["failed", run.items[1]!.note], ["done", ""]]);
    expect(run.items[0]!.missing).toEqual(["merchant", "date", "category", "notes"]);
    expect(run.items[1]!.note).toContain("Date must look like 2026-11-03.");
    expect(run.items[1]!.step).toBe(recording.plan!.steps.at(-1)!.title);
    expect(run).toMatchObject({ done: 1, failed: 1 });
  }, 30_000);

  it("says what the person last did and never what they typed, takes a step back, and writes nothing down while paused", async () => {
    const on = await serve();
    await on.call("POST", "/api/bots/bot-1/demos", { surface: "browser" });
    const person = on.person();
    const live = async () => (await on.call<{ recordings: DemoRecording[] }>("GET", "/api/bots/bot-1/demos")).body.recordings[0]!;
    await person.click("New expense");
    expect((await live()).seeing).toEqual({ kind: "click", name: "New expense" });
    await person.click("Merchant");
    await person.type("Blue Door Coffee");
    const typing = await live();
    expect(typing.seeing).toMatchObject({ kind: "type", name: "Merchant", chars: 16 });
    expect(JSON.stringify(typing)).not.toContain("Blue Door");

    const undone = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos/undo");
    expect(undone.status).toBe(200);
    expect(undone.body.recording).toMatchObject({ eventCount: 2, seeing: { kind: "click", name: "Merchant" } });

    const paused = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos/pause", { paused: true });
    expect(paused.body.recording.paused).toBe(true);
    await person.click("Amount");
    await person.type("18.40");
    expect((await live()).eventCount).toBe(2);
    const resumed = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos/pause", { paused: false });
    expect(resumed.body.recording.paused).toBeUndefined();
    await person.click("Notes");
    expect(await live()).toMatchObject({ eventCount: 3, seeing: { kind: "click", name: "Notes" } });

    const stopped = await on.call<{ recording: DemoRecording }>("POST", "/api/bots/bot-1/demos/stop");
    expect(stopped.body.recording.status).toBe("ready");
    expect(stopped.body.recording.seeing).toBeUndefined();
    expect(stopped.body.recording.plan!.steps.map((step) => step.title).join(" | ")).not.toContain("Amount");
    expect((await on.call("POST", "/api/bots/bot-1/demos/undo")).status).toBe(409);
  });

  it("reads the inputs for a person to look over, runs what they send back, and waits on a file that gets stuck", async () => {
    const on = await serve();
    const recording = await recorded(on);
    const files = [{ name: "bad-date.txt", content: "Merchant: Corner Deli\nAmount: 9.00\nDate: yesterday\nCategory: Meals\nNotes: Lunch\n" }, receiptFiles()[2]!];
    const read = await on.call<{ items: DemoReplayItem[] }>("POST", `/api/demos/${recording.id}/inputs`, { files });
    expect(read.status).toBe(200);
    expect(read.body.items.map((item) => [item.label, item.values.date === "yesterday", item.missing])).toEqual([["bad-date.txt", true, []], [files[1]!.name, false, []]]);
    expect(on.page.expenses()).toHaveLength(1);

    const begun = await on.call<{ run: DemoReplayRun }>("POST", `/api/demos/${recording.id}/replay`, { items: read.body.items, ask: true });
    expect(begun.status).toBe(202);
    const asks = () => on.changes.filter((change) => change.run?.asking).length;
    const asked = async (count: number) => {
      for (let tries = 0; tries < 1600 && asks() < count; tries++) await new Promise((resolve) => setTimeout(resolve, 25));
      return (await on.call<{ run: DemoReplayRun }>("GET", `/api/demos/${recording.id}/replay`)).body.run;
    };
    const waiting = await asked(1);
    expect(waiting.status).toBe("running");
    expect(waiting.asking).toMatchObject({ item: read.body.items[0]!.id, step: recording.plan!.steps.at(-1)!.title });
    expect(waiting.asking!.note).toContain("Date must look like 2026-11-03.");
    expect(waiting.items[1]!.status).toBe("waiting");

    expect((await on.call("POST", `/api/demos/${recording.id}/replay/decide`, { decision: "retry" })).body).toEqual({ decided: true });
    expect((await asked(2)).asking).toBeTruthy();
    expect((await on.call("POST", `/api/demos/${recording.id}/replay/decide`, { decision: "skip" })).body).toEqual({ decided: true });
    const run = await finished(on, recording.id);
    expect(run.items.map((item) => item.status)).toEqual(["failed", "done"]);
    expect(run.asking).toBeUndefined();
    expect((await on.call("POST", `/api/demos/${recording.id}/replay/decide`, { decision: "skip" })).body).toEqual({ decided: false });
    expect((await on.call("POST", `/api/demos/${recording.id}/replay`, { items: [{ id: "x", label: "x" }] })).status).toBe(400);
  }, 60_000);

  it("fills a date that is always today's with the day it is done, and never asks a file for it", async () => {
    const on = await serve();
    const recording = await recorded(on);
    const plan = setBlankToday(recording.plan!, "date", true) as DemoPlan;
    const saved = await on.call<{ recording: DemoRecording }>("PUT", `/api/demos/${recording.id}/plan`, { plan });
    expect(saved.body.recording.plan!.blanks.find((blank) => blank.name === "date")).toMatchObject({ today: true });
    await on.call("POST", `/api/demos/${recording.id}/skill`, {});
    expect(on.installed[0]!.content).toContain("today's date");

    const read = await on.call<{ items: DemoReplayItem[] }>("POST", `/api/demos/${recording.id}/inputs`, { files: [{ name: "no-date.txt", content: "Merchant: Corner Deli\nAmount: 9.00\nCategory: Meals\nNotes: Lunch\n" }] });
    expect(read.body.items[0]!.missing).toEqual([]);
    await on.call("POST", `/api/demos/${recording.id}/replay`, { items: read.body.items });
    expect(await finished(on, recording.id)).toMatchObject({ done: 1, failed: 0 });
    expect(on.page.expenses().at(-1)).toMatchObject({ merchant: "Corner Deli", date: dayText(new Date()) });
  });

  it("hands a step to the bot's own turn when the page differs, and stops when told to", async () => {
    const asked: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const on = await serve({ turn: async (text) => { asked.push(text); await held; return /Is this true/.test(text) ? "NO" : "STUCK: nothing on this page is called that."; } });
    const recording = await recorded(on);
    const broken = { ...recording.plan!, steps: recording.plan!.steps.map((step) => ({ ...step, actions: step.actions.map((action) => (action.do === "click" && action.name === "New expense" ? { ...action, name: "Create claim" } : action)) })) };
    expect((await on.call("PUT", `/api/demos/${recording.id}/plan`, { plan: broken })).status).toBe(200);

    await on.call("POST", `/api/demos/${recording.id}/replay`, { files: receiptFiles().slice(1, 4) });
    for (let tries = 0; tries < 200 && asked.length === 0; tries++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await on.call("POST", `/api/demos/${recording.id}/replay`, { files: receiptFiles().slice(1, 2) })).status).toBe(409);
    expect((await on.call("POST", "/api/bots/bot-1/demos", { surface: "browser" })).status).toBe(409);
    expect((await on.call<{ stopped: boolean }>("POST", `/api/demos/${recording.id}/replay/stop`)).body.stopped).toBe(true);
    release();
    const run = await finished(on, recording.id);

    expect(run.status).toBe("stopped");
    expect(run.items[0]).toMatchObject({ status: "failed" });
    expect(run.items[0]!.note).toMatch(/stuck/i);
    expect(run.items.slice(1).every((item) => item.status === "skipped")).toBe(true);
    expect(asked[0]).toContain("Create claim");
    expect(asked[0]).toMatch(/Could not find the button "Create claim"/);
    expect(asked[0]).toMatch(/DONE, or STUCK/);
  }, 30_000);

  it("answers only the owner or an admin", async () => {
    const on = await serve({ guest: true });
    const id = "demo-00000000-0000-4000-8000-000000000000";

    for (const [method, path] of [["GET", "/api/bots/bot-1/demos"], ["POST", "/api/bots/bot-1/demos"], ["GET", `/api/demos/${id}`], ["PUT", `/api/demos/${id}/plan`], ["POST", `/api/demos/${id}/skill`], ["GET", `/api/demos/${id}/frames/f${"0".repeat(20)}`]] as const) {
      expect((await on.call(method, path, method === "GET" ? undefined : {})).status, `${method} ${path}`).toBe(403);
    }
    expect((await on.call("GET", "/api/elsewhere")).status).toBe(404);
  });

  it("removes a recording and everything of it", async () => {
    const on = await serve();
    const recording = await recorded(on);

    expect((await on.call("DELETE", `/api/demos/${recording.id}`)).status).toBe(200);
    expect((await on.call("GET", `/api/demos/${recording.id}`)).status).toBe(404);
    expect(on.changes.at(-1)).toEqual({ botId: "bot-1", removed: recording.id });
  });
});
