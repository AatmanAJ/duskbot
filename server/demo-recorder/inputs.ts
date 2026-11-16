import type { DemoBlank } from "../../shared/demo-recording.ts";
import type { DemoInputs } from "./replay.ts";

/** One run's values as a file gave them. */
export interface InputRecord {
  /** The file, and the row for a table: "expense-07.json", "trips.csv row 3". */
  source: string;
  /** The folder the file is in, for a file name a blank holds. */
  folder?: string;
  values: Record<string, string>;
}

/** Reads the records of a .json, .csv, .tsv, .yaml, .yml, .txt or .md file's text. */
export function parseInputText(_fileName: string, _text: string): InputRecord[] | { error: string } {
  throw new Error("not built");
}

/** A record's values by blank, matched by name or by the field's label whatever the spacing and case. */
export function matchInputs(_blanks: readonly DemoBlank[], _record: InputRecord): { inputs: DemoInputs; missing: string[] } {
  throw new Error("not built");
}

export interface InputFolder {
  records: InputRecord[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * Every record in a folder's own files that holds a value for one of `blanks`, by file name in natural order (expense-2
 * before expense-10). Folders inside it are not read; `except` leaves files out by name.
 */
export function readInputFolder(_folder: string, _blanks: readonly DemoBlank[], _options: { except?: readonly string[] } = {}): InputFolder {
  throw new Error("not built");
}
