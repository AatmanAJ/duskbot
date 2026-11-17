import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { validatePlan } from "../../shared/demo-plan.ts";
import type { DemoPlan, DemoRecording, DemoReplayReport, DemoSurface, DemoTrace } from "../../shared/demo-recording.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import { writeFileAtomic } from "../atomic.ts";
import { createDemoCapture, type AccessibilityProbe, type DemoCapture, type RawInput, type ScreenSource } from "./capture.ts";
import { compileDemo, type DemoEngine } from "./compiler.ts";
import { createFrameStore, readFrameFile, FRAME_ID, type ImageMasker } from "./frames.ts";
import { runReplay, type ReplayOptions } from "./replay.ts";
import { demoRoutinePrompt, renderDemoSkill } from "./skill.ts";

export interface DemoRecorderDeps {
  /** Where recordings are kept: a folder of this computer's data, never a backup. */
  dir: string;
  engine?: (botId: string) => DemoEngine | null;
  skills: { install(botId: string, source: string, files: Array<{ path: string; content: string }>): { name: string } | { error: string } };
  routines?: { create(input: { name: string; prompt: string; botId: string }): { id: string } | { error: string } };
  log?: (line: string) => void;
  scrub?: (text: string) => string;
  masker?: ImageMasker;
  now?: () => number;
  onChange?: (recording: DemoRecording) => void;
}

export interface StartRequest {
  botId: string;
  surface: DemoSurface;
  probe: AccessibilityProbe;
  screen: ScreenSource;
  threadId?: string;
}

export interface DemoRecorder {
  start(request: StartRequest): DemoRecording | { error: string };
  /** What the person did, before it reaches the screen; nothing happens when the bot is not being recorded. */
  input(botId: string, raw: RawInput): Promise<void>;
  /** The same for a caller that passes the input on afterwards and calls the answer once it has landed. It never rejects: a recording that cannot be written must not hold a person's click back. */
  relay(botId: string, raw: RawInput): Promise<() => void>;
  recording(botId: string): boolean;
  /** Ends the recording and turns it into steps. */
  stop(botId: string): Promise<DemoRecording | { error: string }>;
  cancel(botId: string): Promise<void>;
  /** Security: while paused, what the person does is passed on to the screen and never looked at or written down. */
  pause(botId: string, paused: boolean): DemoRecording | { error: string };
  /** Takes back the last thing written down in the recording under way. */
  undo(botId: string): Promise<DemoRecording | { error: string }>;
  get(id: string): DemoRecording | null;
  list(botId?: string): DemoRecording[];
  updatePlan(id: string, plan: unknown): DemoRecording | { error: string };
  saveSkill(id: string, options?: { name?: string }): DemoRecording | { error: string };
  saveRoutine(id: string, options: { name?: string; source: string }): DemoRecording | { error: string };
  frame(id: string, frameId: string): { data: Buffer; type: string } | null;
  remove(id: string): boolean;
  replay(id: string, request: Omit<ReplayOptions, "plan">): Promise<DemoReplayReport | { error: string }>;
}

const RECORDING_ID = /^demo-[a-f0-9-]{36}$/;
const RECORD_FILE = "recording.json";
const TRACE_FILE = "trace.json";
const FRAMES_DIR = "frames";
const PRIVATE_FILE = { mode: 0o600 } as const;
const NOT_FOUND = "That recording is gone.";
const NOT_READY = "That recording has no steps yet.";

function readRecording(path: string): DemoRecording | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<DemoRecording> | null;
    if (!value || typeof value !== "object" || typeof value.id !== "string" || !RECORDING_ID.test(value.id) || typeof value.botId !== "string") return null;
    if (value.surface !== "browser" && value.surface !== "computer") return null;
    const plan = value.plan === undefined ? undefined : validatePlan(value.plan);
    return {
      id: value.id,
      botId: value.botId,
      ...(typeof value.threadId === "string" ? { threadId: value.threadId } : {}),
      surface: value.surface,
      accessibility: value.accessibility === "dom" || value.accessibility === "os" ? value.accessibility : "none",
      status: value.status === "ready" || value.status === "recording" || value.status === "compiling" ? value.status : "failed",
      createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
      durationMs: typeof value.durationMs === "number" ? value.durationMs : 0,
      eventCount: typeof value.eventCount === "number" ? value.eventCount : 0,
      frames: Array.isArray(value.frames) ? value.frames.filter((frame) => frame && typeof frame.id === "string" && FRAME_ID.test(frame.id) && (frame.type === "image/png" || frame.type === "image/jpeg")) : [],
      framesSkipped: typeof value.framesSkipped === "number" ? value.framesSkipped : 0,
      ...(plan && "plan" in plan ? { plan: plan.plan } : {}),
      ...(typeof value.skillName === "string" ? { skillName: value.skillName } : {}),
      ...(typeof value.routineId === "string" ? { routineId: value.routineId } : {}),
      ...(typeof value.routineName === "string" ? { routineName: value.routineName } : {}),
      ...(typeof value.routineSource === "string" ? { routineSource: value.routineSource } : {}),
      ...(typeof value.error === "string" ? { error: value.error } : {}),
      ...(value.truncated === true ? { truncated: true } : {}),
    };
  } catch {
    return null;
  }
}

export function createDemoRecorder(deps: DemoRecorderDeps): DemoRecorder {
  const now = deps.now ?? Date.now;
  const scrub = deps.scrub ?? redactSecretsInText;
  const recordings = new Map<string, DemoRecording>();
  const active = new Map<string, { recording: DemoRecording; capture: DemoCapture; paused: boolean }>();
  const folderOf = (id: string) => join(deps.dir, id);
  const copy = (recording: DemoRecording) => structuredClone(recording);

  function save(recording: DemoRecording): void {
    mkdirSync(folderOf(recording.id), { recursive: true, mode: 0o700 });
    writeFileAtomic(join(folderOf(recording.id), RECORD_FILE), `${JSON.stringify(recording, null, 2)}\n`, PRIVATE_FILE);
  }

  function changed(recording: DemoRecording): DemoRecording {
    recordings.set(recording.id, recording);
    save(recording);
    const sent = copy(recording);
    try { deps.onChange?.(sent); } catch {}
    return copy(recording);
  }

  function discard(id: string): void {
    recordings.delete(id);
    rmSync(folderOf(id), { recursive: true, force: true });
  }

  if (existsSync(deps.dir)) {
    for (const name of readdirSync(deps.dir)) {
      if (!RECORDING_ID.test(name)) continue;
      const recording = readRecording(join(deps.dir, name, RECORD_FILE));
      if (!recording || recording.id !== name) continue;
      if (recording.status === "recording" || recording.status === "compiling") {
        recording.status = "failed";
        recording.error = "The recording was cut off before it was finished.";
        save(recording);
      }
      recordings.set(recording.id, recording);
    }
  }

  /** The recording with its steps, or why it cannot be used. A failed recording carries an error of its own, so the two are told apart by `refused`. */
  const ready = (id: string): { recording: DemoRecording; plan: DemoPlan; refused?: undefined } | { refused: { error: string } } => {
    const recording = recordings.get(id);
    if (!recording) return { refused: { error: NOT_FOUND } };
    return recording.status === "ready" && recording.plan ? { recording, plan: recording.plan } : { refused: { error: NOT_READY } };
  };

  function counted(botId: string, entry: { recording: DemoRecording; capture: DemoCapture }): void {
    if (active.get(botId) !== entry) return;
    const seeing = entry.capture.seeing;
    if (entry.capture.eventCount === entry.recording.eventCount && JSON.stringify(seeing ?? null) === JSON.stringify(entry.recording.seeing ?? null)) return;
    entry.recording.eventCount = entry.capture.eventCount;
    if (seeing) entry.recording.seeing = seeing;
    else delete entry.recording.seeing;
    changed(entry.recording);
  }

  const recorder: DemoRecorder = {
    start(request) {
      if (active.has(request.botId)) return { error: "This bot is already being recorded." };
      const id = `demo-${randomUUID()}`;
      const frames = createFrameStore({ dir: join(folderOf(id), FRAMES_DIR), ...(deps.masker ? { masker: deps.masker } : {}) });
      const capture = createDemoCapture({ surface: request.surface, probe: request.probe, screen: request.screen, frames, now, scrub, ...(deps.log ? { log: deps.log } : {}) });
      const recording: DemoRecording = {
        id,
        botId: request.botId,
        ...(request.threadId ? { threadId: request.threadId } : {}),
        surface: request.surface,
        accessibility: request.probe.kind,
        status: "recording",
        createdAt: now(),
        durationMs: 0,
        eventCount: 0,
        frames: [],
        framesSkipped: 0,
      };
      active.set(request.botId, { recording, capture, paused: false });
      return changed(recording);
    },

    async input(botId, raw) {
      const entry = active.get(botId);
      if (!entry || entry.paused) return;
      await entry.capture.input(raw);
      counted(botId, entry);
    },

    async relay(botId, raw) {
      const entry = active.get(botId);
      if (!entry || entry.paused) return () => {};
      try {
        const landed = await entry.capture.relay(raw);
        counted(botId, entry);
        return landed;
      } catch {
        deps.log?.("demo recorder: an input could not be written down");
        return () => {};
      }
    },

    recording: (botId) => active.has(botId),

    async stop(botId) {
      const entry = active.get(botId);
      if (!entry) return { error: "This bot is not being recorded." };
      active.delete(botId);
      const { recording, capture } = entry;
      delete recording.paused;
      delete recording.seeing;
      let trace: DemoTrace;
      try {
        trace = await capture.finish();
      } catch {
        return changed({ ...recording, status: "failed", error: "The recording could not be read back." });
      }
      if (!recordings.has(recording.id)) return { error: NOT_FOUND };
      Object.assign(recording, { durationMs: trace.durationMs, eventCount: trace.events.length, frames: trace.frames, framesSkipped: trace.framesSkipped, ...(trace.truncated ? { truncated: true } : {}) });
      if (trace.events.length === 0) return changed(Object.assign(recording, { status: "failed" as const, error: "Nothing was recorded." }));
      writeFileAtomic(join(folderOf(recording.id), TRACE_FILE), `${JSON.stringify(trace)}\n`, PRIVATE_FILE);
      changed(Object.assign(recording, { status: "compiling" as const }));
      try {
        const plan = await compileDemo(trace, { engine: deps.engine?.(botId) ?? null, ...(deps.log ? { log: deps.log } : {}) });
        if (!recordings.has(recording.id)) return { error: NOT_FOUND };
        return changed(Object.assign(recording, { status: "ready" as const, plan }));
      } catch {
        if (!recordings.has(recording.id)) return { error: NOT_FOUND };
        return changed(Object.assign(recording, { status: "failed" as const, error: "The steps could not be worked out from the recording." }));
      }
    },

    async cancel(botId) {
      const entry = active.get(botId);
      if (!entry) return;
      active.delete(botId);
      await entry.capture.finish().catch(() => {});
      discard(entry.recording.id);
    },

    pause(botId, paused) {
      const entry = active.get(botId);
      if (!entry) return { error: "This bot is not being recorded." };
      entry.paused = paused;
      if (paused) entry.recording.paused = true;
      else delete entry.recording.paused;
      return changed(entry.recording);
    },

    async undo(botId) {
      const entry = active.get(botId);
      if (!entry) return { error: "This bot is not being recorded." };
      await entry.capture.undo();
      counted(botId, entry);
      return copy(entry.recording);
    },

    get(id) {
      const recording = recordings.get(id);
      return recording ? copy(recording) : null;
    },

    list(botId) {
      return [...recordings.values()].filter((recording) => botId === undefined || recording.botId === botId).sort((a, b) => b.createdAt - a.createdAt).map(copy);
    },

    updatePlan(id, plan) {
      const found = ready(id);
      if (found.refused) return found.refused;
      const { recording } = found;
      const checked = validatePlan(plan);
      if ("error" in checked) return checked;
      return changed(Object.assign(recording, { plan: checked.plan }));
    },

    saveSkill(id, options) {
      const found = ready(id);
      if (found.refused) return found.refused;
      const { recording, plan } = found;
      const skill = renderDemoSkill(plan, options?.name ? { name: options.name } : {});
      const installed = deps.skills.install(recording.botId, `demo:${recording.id}`, [{ path: "SKILL.md", content: skill.content }]);
      if ("error" in installed) return installed;
      return changed(Object.assign(recording, { skillName: installed.name }));
    },

    saveRoutine(id, options) {
      const found = ready(id);
      if (found.refused) return found.refused;
      const { recording, plan } = found;
      if (!deps.routines) return { error: "Routines are not available here." };
      if (recording.routineId) return { error: "This task already has a routine. Change it with the bot's other routines." };
      const source = options.source.trim();
      if (!source) return { error: "Say what the routine should run on: a folder, a file, or a list." };
      if (!recording.skillName) {
        const skilled = recorder.saveSkill(id);
        if (!("id" in skilled)) return skilled;
      }
      const skillName = recording.skillName;
      if (!skillName) return { error: "The skill could not be saved." };
      const created = deps.routines.create({ name: options.name?.trim() || plan.title, prompt: demoRoutinePrompt(plan, skillName, source), botId: recording.botId });
      if ("error" in created) return created;
      return changed(Object.assign(recording, { routineId: created.id, routineName: options.name?.trim() || plan.title, routineSource: source }));
    },

    frame(id, frameId) {
      const recording = RECORDING_ID.test(id) ? recordings.get(id) : undefined;
      const frame = recording?.frames.find((each) => each.id === frameId);
      const data = frame ? readFrameFile(join(folderOf(id), FRAMES_DIR), frame) : null;
      return frame && data ? { data, type: frame.type } : null;
    },

    remove(id) {
      const recording = recordings.get(id);
      if (!recording) return false;
      const entry = active.get(recording.botId);
      discard(id);
      if (entry?.recording.id === id) {
        active.delete(recording.botId);
        void entry.capture.finish().catch(() => {}).then(() => rmSync(folderOf(id), { recursive: true, force: true }));
      }
      return true;
    },

    async replay(id, request) {
      const found = ready(id);
      if (found.refused) return found.refused;
      const log = request.log ?? deps.log;
      return runReplay({ ...request, plan: found.plan, ...(log ? { log } : {}) });
    },
  };
  return recorder;
}
