import type { DemoDraft, DemoPlace } from "../../shared/demo-recording.ts";
import type { DemoNamer } from "./compile.ts";
import type { DemoPagePort } from "./ports.ts";
import type { DemoSkillFiles } from "./skill-file.ts";

export interface DemoRecorderDeps {
  /** The page the person is showing the task on, or why it cannot be read. */
  port(botId: string, place: DemoPlace): Promise<Pick<DemoPagePort, "evaluate"> | { refusal: string }>;
  /** Whether the person holds control there: nothing is recorded unless they do. */
  held(botId: string, place: DemoPlace): boolean;
  nameBlanks?(botId: string): DemoNamer;
  /** Saves the skill for the bot, enabled; the name it was saved under. */
  saveSkill(botId: string, skill: DemoSkillFiles): { name: string } | { error: string };
  /** Sets up a routine that runs `prompt`, switched off; its id. */
  createRoutine?(botId: string, routine: { name: string; prompt: string }): { id: string } | { error: string };
  /** Told of every change to a bot's draft. */
  changed?(draft: DemoDraft): void;
  scrub?(text: string): string;
  log?(line: string): void;
  pollMs?: number;
  now?: () => number;
}

export type DemoStepPatch = { blank: string | null } | { value: string };
export type DemoSaveResult = { skill: string; routineId?: string } | { error: string };

/** Each bot's recording while it is made and reviewed. In memory on purpose: a draft is a person's unsaved work, and what is saved is a skill. */
export class DemoRecorder {
  constructor(_deps: DemoRecorderDeps) {}

  draft(_botId: string): DemoDraft {
    throw new Error("not built");
  }

  start(_botId: string, _place: DemoPlace): Promise<DemoDraft | { error: string }> {
    throw new Error("not built");
  }

  /** Reads the page now, so the list shows what was just done. */
  sync(_botId: string): Promise<DemoDraft> {
    throw new Error("not built");
  }

  /** Stops recording and names the blanks, leaving the steps to review. */
  stop(_botId: string): Promise<DemoDraft> {
    throw new Error("not built");
  }

  patchStep(_botId: string, _stepId: string, _patch: DemoStepPatch): DemoDraft | { error: string } {
    throw new Error("not built");
  }

  /** Renames a blank everywhere it is used. */
  renameBlank(_botId: string, _from: string, _to: string): DemoDraft | { error: string } {
    throw new Error("not built");
  }

  deleteStep(_botId: string, _stepId: string): DemoDraft | { error: string } {
    throw new Error("not built");
  }

  setTitle(_botId: string, _title: string): DemoDraft | { error: string } {
    throw new Error("not built");
  }

  discard(_botId: string): DemoDraft {
    throw new Error("not built");
  }

  save(_botId: string, _as: "skill" | "routine", _options: { folder?: string } = {}): Promise<DemoSaveResult> {
    throw new Error("not built");
  }

  /** The person handed control back: recording ends, and what was recorded stays for review. */
  released(_botId: string, _place: DemoPlace): Promise<void> {
    throw new Error("not built");
  }
}
