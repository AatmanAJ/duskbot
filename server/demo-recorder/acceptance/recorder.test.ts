// One bot's demonstration from Record to a saved skill: started, fed the person's input, stopped into steps, edited,
// saved as a skill and a routine, replayed, and kept across a restart.
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { renameBlank } from "../../../shared/demo-plan.ts";
import type { DemoPlan, DemoRecording } from "../../../shared/demo-recording.ts";
import { parseSkillMd } from "../../../shared/skill-md.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import type { DemoEngine } from "../compiler.ts";
import { readDemoInputs } from "../inputs.ts";
import { createDemoRecorder, type DemoRecorderDeps } from "../recorder.ts";
import { openPortal, receiptFiles, showOneExpense, type PortalPage } from "../testing/portal-page.ts";

const dirs: string[] = [];
const pages: PortalPage[] = [];
afterEach(async () => {
  for (const page of pages.splice(0)) await page.close();
  for (const dir of dirs.splice(0)) await removeTempDir(dir);
});

interface Rig {
  dir: string;
  recorder: ReturnType<typeof createDemoRecorder>;
  installed: Array<{ botId: string; source: string; files: Array<{ path: string; content: string }> }>;
  routines: Array<{ name: string; prompt: string; botId: string }>;
  changes: DemoRecording[];
  prompts: string[];
}

function rig(overrides: Partial<DemoRecorderDeps> = {}, dir = mkdtempSync(join(tmpdir(), "dusk-demo-recorder-"))): Rig {
  if (!dirs.includes(dir)) dirs.push(dir);
  const installed: Rig["installed"] = [];
  const routines: Rig["routines"] = [];
  const changes: DemoRecording[] = [];
  const prompts: string[] = [];
  let clock = 1_700_000_000_000;
  const recorder = createDemoRecorder({
    dir,
    now: () => (clock += 40),
    skills: { install: (botId, source, files) => { installed.push({ botId, source, files }); const parsed = parseSkillMd(files[0]!.content); return "error" in parsed ? parsed : { name: parsed.name }; } },
    routines: { create: (input) => { routines.push(input); return { id: `routine-${routines.length}` }; } },
    onChange: (recording) => changes.push(structuredClone(recording)),
    ...overrides,
  });
  return { dir, recorder, installed, routines, changes, prompts };
}

async function portal(): Promise<PortalPage> {
  const page = await openPortal("standard");
  pages.push(page);
  return page;
}

/** Records one expense for `botId` and stops. */
async function recorded(on: Rig, botId = "bot-1"): Promise<DemoRecording> {
  const page = await portal();
  const started = on.recorder.start({ botId, surface: "browser", probe: page.probe, screen: page.screen, threadId: "thread-1" });
  if ("error" in started) throw new Error(started.error);
  await showOneExpense(page.person({ input: (raw) => on.recorder.input(botId, raw) }));
  const stopped = await on.recorder.stop(botId);
  if ("error" in stopped) throw new Error(stopped.error);
  return stopped;
}

describe("recording a demonstration", () => {
  it("goes from recording to ready steps", async () => {
    const on = rig();
    const page = await portal();
    const started = on.recorder.start({ botId: "bot-1", surface: "browser", probe: page.probe, screen: page.screen, threadId: "thread-1" });
    if ("error" in started) throw new Error(started.error);

    expect(started).toMatchObject({ botId: "bot-1", threadId: "thread-1", surface: "browser", accessibility: "dom", status: "recording", eventCount: 0 });
    expect(on.recorder.recording("bot-1")).toBe(true);
    await showOneExpense(page.person({ input: (raw) => on.recorder.input("bot-1", raw) }));
    const stopped = await on.recorder.stop("bot-1");
    if ("error" in stopped) throw new Error(stopped.error);

    expect(stopped.id).toBe(started.id);
    expect(stopped.status).toBe("ready");
    expect(stopped.eventCount).toBeGreaterThanOrEqual(8);
    expect(stopped.durationMs).toBeGreaterThan(0);
    expect(stopped.plan!.blanks.map((blank) => blank.name)).toEqual(["merchant", "amount", "date", "category", "notes"]);
    expect(stopped.plan!.steps.length).toBeGreaterThanOrEqual(6);
    expect(on.recorder.recording("bot-1")).toBe(false);
    expect(on.changes.map((change) => change.status)).toEqual(expect.arrayContaining(["recording", "compiling", "ready"]));
    expect(on.changes.at(-1)!.status).toBe("ready");
  });

  it("serves the pictures its steps point at", async () => {
    const on = rig();
    const recording = await recorded(on);
    const withPicture = recording.plan!.steps.filter((step) => step.frame);

    expect(withPicture.length).toBeGreaterThan(0);
    for (const step of withPicture) {
      const frame = on.recorder.frame(recording.id, step.frame!);
      expect(frame, step.title).toBeTruthy();
      expect(frame!.type).toBe("image/png");
      expect(frame!.data.subarray(1, 4).toString("ascii")).toBe("PNG");
    }
    expect(on.recorder.frame(recording.id, "../recording")).toBeNull();
    expect(on.recorder.frame("../../etc", "passwd")).toBeNull();
  });

  it("uses the bot's model for the steps when it has one", async () => {
    const prompts: string[] = [];
    const engine: DemoEngine = {
      generateText: async (prompt) => {
        prompts.push(prompt);
        const seqs = [...prompt.matchAll(/(?:^|\n)\s*(\d+)[.:)]/g)].map((match) => Number(match[1]));
        return JSON.stringify({ title: "File an expense in Harbor", summary: "Adds one expense.", steps: [{ title: "File the expense", goal: "File the expense for {{merchant}}.", events: [...new Set(seqs)].sort((a, b) => a - b) }] });
      },
    };
    const on = rig({ engine: (botId) => (botId === "bot-1" ? engine : null) });
    const recording = await recorded(on);

    expect(prompts).toHaveLength(1);
    expect(recording.plan).toMatchObject({ compiledBy: "engine", title: "File an expense in Harbor" });
    expect(recording.plan!.steps).toHaveLength(1);
    expect(recording.plan!.steps[0]!.actions.length).toBeGreaterThanOrEqual(8);
  });

  it("records one demonstration for a bot at a time, and each bot its own", async () => {
    const on = rig();
    const first = await portal();
    const second = await portal();
    expect(on.recorder.start({ botId: "bot-1", surface: "browser", probe: first.probe, screen: first.screen })).not.toHaveProperty("error");
    expect(on.recorder.start({ botId: "bot-1", surface: "browser", probe: first.probe, screen: first.screen })).toHaveProperty("error");
    expect(on.recorder.start({ botId: "bot-2", surface: "browser", probe: second.probe, screen: second.screen })).not.toHaveProperty("error");

    await first.person({ input: (raw) => on.recorder.input("bot-1", raw) }).click("New expense");
    await on.recorder.input("bot-3", { type: "text", text: "nobody is recording this" });
    const one = await on.recorder.stop("bot-1");
    const two = await on.recorder.stop("bot-2");
    if (!("id" in one) || !("id" in two)) throw new Error("stop was refused");

    expect(one.eventCount).toBe(1);
    expect(two.eventCount).toBe(0);
    expect(two.status).toBe("failed");
    expect(two.error).toBeTruthy();
    expect(await on.recorder.stop("bot-1")).toHaveProperty("error");
  });

  it("throws a cancelled recording away", async () => {
    const on = rig();
    const page = await portal();
    const started = on.recorder.start({ botId: "bot-1", surface: "browser", probe: page.probe, screen: page.screen });
    if ("error" in started) throw new Error(started.error);
    await page.person({ input: (raw) => on.recorder.input("bot-1", raw) }).click("New expense");
    await on.recorder.cancel("bot-1");

    expect(on.recorder.recording("bot-1")).toBe(false);
    expect(on.recorder.get(started.id)).toBeNull();
    expect(on.recorder.list()).toEqual([]);
    expect(readdirSync(on.dir)).toEqual([]);
  });
});

describe("a recording that is ready", () => {
  it("takes an edited plan and refuses one that is not a plan", async () => {
    const on = rig();
    const recording = await recorded(on);
    const renamed = renameBlank(recording.plan!, "merchant", "vendor") as DemoPlan;
    const updated = on.recorder.updatePlan(recording.id, { ...renamed, title: "File a Harbor expense" });
    if ("error" in updated) throw new Error(updated.error);

    expect(updated.plan!.title).toBe("File a Harbor expense");
    expect(updated.plan!.blanks[0]!.name).toBe("vendor");
    expect(on.recorder.get(recording.id)!.plan!.blanks[0]!.name).toBe("vendor");
    expect(on.recorder.updatePlan(recording.id, { title: "nothing else" })).toHaveProperty("error");
    expect(on.recorder.updatePlan("no-such-recording", renamed)).toHaveProperty("error");
    expect(on.recorder.get(recording.id)!.plan!.title).toBe("File a Harbor expense");
  });

  it("is saved as a skill for its bot", async () => {
    const on = rig();
    const recording = await recorded(on);
    const saved = on.recorder.saveSkill(recording.id, { name: "Harbor expense" });
    if ("error" in saved) throw new Error(saved.error);

    expect(saved.skillName).toBe("harbor-expense");
    expect(on.installed).toHaveLength(1);
    expect(on.installed[0]).toMatchObject({ botId: "bot-1" });
    expect(on.installed[0]!.source).toMatch(/^demo:/);
    expect(on.installed[0]!.files.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(parseSkillMd(on.installed[0]!.files[0]!.content)).toMatchObject({ name: "harbor-expense" });
    expect(on.recorder.get(recording.id)!.skillName).toBe("harbor-expense");
  });

  it("says why when the skill cannot be saved", async () => {
    const on = rig({ skills: { install: () => ({ error: "This bot has too many skills." }) } });
    const recording = await recorded(on);

    expect(on.recorder.saveSkill(recording.id)).toEqual({ error: "This bot has too many skills." });
    expect(on.recorder.get(recording.id)!.skillName).toBeUndefined();
  });

  it("is saved as a routine that uses the skill, saving the skill first when it has to", async () => {
    const on = rig();
    const recording = await recorded(on);
    const saved = on.recorder.saveRoutine(recording.id, { name: "Friday receipts", source: "the files in ~/Receipts/new" });
    if ("error" in saved) throw new Error(saved.error);

    expect(on.installed).toHaveLength(1);
    expect(saved.skillName).toBeTruthy();
    expect(saved.routineId).toBe("routine-1");
    expect(on.routines[0]).toMatchObject({ name: "Friday receipts", botId: "bot-1" });
    expect(on.routines[0]!.prompt).toContain(saved.skillName!);
    expect(on.routines[0]!.prompt).toContain("~/Receipts/new");
  });

  it("replays for other inputs on a screen it is given", async () => {
    const on = rig();
    const recording = await recorded(on);
    const page = await portal();
    const items = (await readDemoInputs(receiptFiles(), recording.plan!.blanks)).slice(1, 4);
    const report = await on.recorder.replay(recording.id, { items, surface: page.surface, wait: async () => {} });
    if ("error" in report) throw new Error(report.error);

    expect(report.done).toBe(3);
    expect(page.expenses().map((expense) => expense.merchant)).toEqual(items.map((item) => item.values.merchant));
    expect(await on.recorder.replay("no-such-recording", { items, surface: page.surface })).toHaveProperty("error");
  });

  it("is still there after a restart, and gone once removed", async () => {
    const on = rig();
    const recording = await recorded(on);
    on.recorder.saveSkill(recording.id);

    const again = rig({}, on.dir);
    const listed = again.recorder.list("bot-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: recording.id, status: "ready", skillName: on.recorder.get(recording.id)!.skillName });
    expect(listed[0]!.plan!.steps.length).toBe(recording.plan!.steps.length);
    expect(again.recorder.list("bot-2")).toEqual([]);
    const step = recording.plan!.steps.find((each) => each.frame)!;
    expect(again.recorder.frame(recording.id, step.frame!)).toBeTruthy();

    expect(again.recorder.remove(recording.id)).toBe(true);
    expect(again.recorder.get(recording.id)).toBeNull();
    expect(again.recorder.remove(recording.id)).toBe(false);
    expect(readdirSync(on.dir)).toEqual([]);
  });

  it("marks a recording that was cut off by a restart as failed", async () => {
    const on = rig();
    const page = await portal();
    const started = on.recorder.start({ botId: "bot-1", surface: "browser", probe: page.probe, screen: page.screen });
    if ("error" in started) throw new Error(started.error);
    await page.person({ input: (raw) => on.recorder.input("bot-1", raw) }).click("New expense");

    const again = rig({}, on.dir);
    expect(again.recorder.recording("bot-1")).toBe(false);
    expect(again.recorder.get(started.id)).toMatchObject({ status: "failed" });
  });

  it("keeps its folder to this computer's user", async () => {
    if (process.platform === "win32") return;
    const on = rig();
    const recording = await recorded(on);
    const folder = join(on.dir, recording.id);

    expect(statSync(folder).mode & 0o077).toBe(0);
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isFile()) expect(statSync(path).mode & 0o077, name).toBe(0);
    }
  });
});
