import type { DemoRecording, DemoStep } from "../../shared/demo-recording.ts";

/** The one AI pass: a prompt in, its reply out, or null when no AI answered. */
export type DemoNamer = (prompt: string) => Promise<string | null>;

export interface CompileOptions {
  title?: string;
  nameBlanks?: DemoNamer;
  timeoutMs?: number;
  /** Blank names the person already chose, by step id: the AI never renames these. */
  keep?: ReadonlyMap<string, string | null>;
}

export interface CompiledDemo {
  recording: DemoRecording;
  /** Where the blanks' names came from. */
  named: "ai" | "labels";
}

/** What the AI is asked: the steps as data, and names for the values that change from run to run. */
export function demoNamingPrompt(_steps: readonly DemoStep[]): string {
  throw new Error("not built");
}

/** Gives every changing value a named blank, asking the AI once and falling back to the page's own labels. */
export function compileDemo(_steps: readonly DemoStep[], _options: CompileOptions = {}): Promise<CompiledDemo> {
  throw new Error("not built");
}
