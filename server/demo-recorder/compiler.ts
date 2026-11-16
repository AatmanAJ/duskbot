import type { DemoPlan, DemoTrace } from "../../shared/demo-recording.ts";

const todo = (): never => { throw new Error("not built"); };

/** One text answer from the bot's model. */
export interface DemoEngine {
  generateText(prompt: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<string>;
}

export interface CompileDeps {
  engine?: DemoEngine | null;
  log?: (line: string) => void;
  timeoutMs?: number;
}

/** The steps written from the recording alone: one for each thing the person did, blanks for what they typed and chose. */
export function outlineDemo(_trace: DemoTrace): DemoPlan { return todo(); }

/** What the model is asked: the recording as lines of text, and the shape of the answer. */
export function compilePrompt(_trace: DemoTrace, _outline: DemoPlan): string { return todo(); }

/** The recording as intent-level steps: the model's when it answers with a plan that holds up, the outline otherwise. */
export function compileDemo(_trace: DemoTrace, _deps?: CompileDeps): Promise<DemoPlan> { return todo(); }
