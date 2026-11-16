import type { DemoRecording } from "../../shared/demo-recording.ts";

/** The file of a saved skill the replayer reads. */
export const DEMO_REFERENCE_PATH = "references/demonstration.md";

export interface DemoSkillFiles {
  name: string;
  files: Array<{ path: string; content: string }>;
}

/** A skill name from a title: "File an expense report" becomes file-an-expense-report. */
export function demoSkillName(_title: string): string {
  throw new Error("not built");
}

/** The skill a recording is saved as: SKILL.md in words a bot can follow by hand, and the steps the replayer runs. */
export function renderDemoSkill(_recording: DemoRecording, _options: { name?: string } = {}): DemoSkillFiles {
  throw new Error("not built");
}

/** The recording a saved skill's reference file holds; null when the file is not one, or was edited into something else. */
export function parseDemoReference(_content: string): DemoRecording | null {
  throw new Error("not built");
}
