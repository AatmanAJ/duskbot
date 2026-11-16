import type { DemoBlank, DemoReplayItem } from "../../shared/demo-recording.ts";
import type { DemoEngine } from "./compiler.ts";

const todo = (): never => { throw new Error("not built"); };

export interface InputFile {
  name: string;
  content: string;
}

/**
 * The values each file gives a plan's blanks: one item for a file, or one for each row of a CSV. Labelled values are
 * read as written; what is left is asked of the model when there is one, and listed as missing otherwise.
 */
export function readDemoInputs(_files: readonly InputFile[], _blanks: readonly DemoBlank[], _deps?: { engine?: DemoEngine | null }): Promise<DemoReplayItem[]> { return todo(); }
