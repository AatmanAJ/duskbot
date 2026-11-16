import type { DemoRecording, DemoReplayReport, DemoSurface } from "../../shared/demo-recording.ts";
import type { AccessibilityProbe, RawInput, ScreenSource } from "./capture.ts";
import type { DemoEngine } from "./compiler.ts";
import type { ImageMasker } from "./frames.ts";
import type { ReplayOptions } from "./replay.ts";

const todo = (): never => { throw new Error("not built"); };

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
  recording(botId: string): boolean;
  /** Ends the recording and turns it into steps. */
  stop(botId: string): Promise<DemoRecording | { error: string }>;
  cancel(botId: string): Promise<void>;
  get(id: string): DemoRecording | null;
  list(botId?: string): DemoRecording[];
  updatePlan(id: string, plan: unknown): DemoRecording | { error: string };
  saveSkill(id: string, options?: { name?: string }): DemoRecording | { error: string };
  saveRoutine(id: string, options: { name?: string; source: string }): DemoRecording | { error: string };
  frame(id: string, frameId: string): { data: Buffer; type: string } | null;
  remove(id: string): boolean;
  replay(id: string, request: Omit<ReplayOptions, "plan">): Promise<DemoReplayReport | { error: string }>;
}

export function createDemoRecorder(_deps: DemoRecorderDeps): DemoRecorder { return todo(); }
