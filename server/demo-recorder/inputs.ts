// The values for a run, from the files people really keep: JSON, a table, YAML, or plain "Key: value" lines.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import Papa from "papaparse";
import { parse as parseYaml } from "yaml";

import type { DemoBlank } from "../../shared/demo-recording.ts";
import { DEMO_VALUE_MAX } from "./events.ts";
import type { DemoInputs } from "./replay.ts";

/** One run's values as a file gave them. */
export interface InputRecord {
  /** The file, and the row for a table: "expense-07.json", "trips.csv row 3". */
  source: string;
  /** The folder the file is in, for a file name a blank holds. */
  folder?: string;
  values: Record<string, string>;
}

export const INPUT_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const INPUT_RECORDS_MAX = 500;
const KEY_MAX = 80;
const EXTENSIONS = new Set([".json", ".csv", ".tsv", ".yaml", ".yml", ".txt", ".md"]);

const withoutMark = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** A value as the page will hold it: its line ends are the page's own. */
const asTyped = (text: string) => text.replace(/\r\n?/gu, "\n").slice(0, DEMO_VALUE_MAX);

function scalar(value: unknown): string | null {
  if (typeof value === "string") return asTyped(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return null;
}

/** A number as the file wrote it, so 18.40 and 00742 reach the form unchanged. */
function numbersAsWritten(_key: string, value: unknown, context?: { source?: string }): unknown {
  return typeof value === "number" && typeof context?.source === "string" ? context.source : value;
}

/** A YAML file's values, with each number as its own text: nothing is rewritten on the way to the page. */
function yamlAsWritten(body: string): unknown {
  const asText = (typed: unknown, written: unknown): unknown => {
    if (Array.isArray(typed)) return typed.map((inner, at) => asText(inner, Array.isArray(written) ? written[at] : undefined));
    if (typed && typeof typed === "object") {
      const texts = written && typeof written === "object" ? written as Record<string, unknown> : {};
      return Object.fromEntries(Object.entries(typed).map(([key, inner]) => [key, asText(inner, texts[key])]));
    }
    return typeof typed === "number" && typeof written === "string" ? written : typed;
  };
  return asText(parseYaml(body), parseYaml(body, { schema: "failsafe" }));
}

/** The scalar fields of an object; lists, nested objects and nulls are not values a form field takes. */
function fields(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const found: Record<string, string> = {};
  for (const [key, inner] of Object.entries(value)) {
    const text = scalar(inner);
    const name = key.trim();
    if (text !== null && name && name.length <= KEY_MAX) found[name] = text;
  }
  return found;
}

function rows(fileName: string, value: unknown): InputRecord[] | { error: string } {
  if (Array.isArray(value)) {
    const records = value.map(fields).filter((row): row is Record<string, string> => row !== null && Object.keys(row).length > 0);
    if (!records.length) return { error: `${fileName} holds a list with no records in it.` };
    return records.slice(0, INPUT_RECORDS_MAX).map((values, at) => ({ source: `${fileName} row ${at + 1}`, values }));
  }
  const values = fields(value);
  if (!values || !Object.keys(values).length) return { error: `${fileName} holds no named values.` };
  return [{ source: fileName, values }];
}

function table(fileName: string, text: string, delimiter: string): InputRecord[] | { error: string } {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, delimiter, skipEmptyLines: "greedy", transformHeader: (header) => header.trim() });
  const records = parsed.data.filter((row) => row && typeof row === "object");
  if (!parsed.meta.fields?.length || !records.length) return { error: `${fileName} has no rows under a header line.` };
  return records.slice(0, INPUT_RECORDS_MAX).map((row, at) => ({
    source: `${fileName} row ${at + 1}`,
    values: Object.fromEntries(parsed.meta.fields!.filter((field) => field && field.length <= KEY_MAX).map((field) => [field, asTyped(String(row[field] ?? ""))])),
  }));
}

function lines(fileName: string, text: string): InputRecord[] | { error: string } {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const match = /^(?:[-*]\s+)?([^:`]{1,80}?)\s*:\s*(.*)$/u.exec(line.replaceAll("**", ""));
    if (!match) continue;
    const key = match[1]!.trim();
    if (key) values[key] = match[2]!.trim().slice(0, DEMO_VALUE_MAX);
  }
  if (!Object.keys(values).length) return { error: `${fileName} has no "Key: value" lines.` };
  return [{ source: fileName, values }];
}

/** Reads the records of a .json, .csv, .tsv, .yaml, .yml, .txt or .md file's text. */
export function parseInputText(fileName: string, text: string): InputRecord[] | { error: string } {
  const extension = extname(fileName).toLowerCase();
  if (!EXTENSIONS.has(extension)) return { error: `${fileName} is not a file inputs are read from (.json, .csv, .tsv, .yaml, .yml, .txt or .md).` };
  const body = withoutMark(text);
  if (!body.trim()) return { error: `${fileName} is empty.` };
  try {
    if (extension === ".json") return rows(fileName, JSON.parse(body, numbersAsWritten));
    if (extension === ".yaml" || extension === ".yml") return rows(fileName, yamlAsWritten(body));
    if (extension === ".csv") return table(fileName, body, ",");
    if (extension === ".tsv") return table(fileName, body, "\t");
    return lines(fileName, body);
  } catch {
    return { error: `${fileName} could not be read as ${extension.slice(1)}.` };
  }
}

const tokens = (text: string) => text.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
const joined = (text: string) => tokens(text).join(" ");
const YES = new Set(["yes", "y", "true", "1", "x", "on", "checked", "ticked"]);

/** A record's values by blank, matched by name or by the field's label whatever the spacing and case. */
export function matchInputs(blanks: readonly DemoBlank[], record: InputRecord): { inputs: DemoInputs; missing: string[] } {
  const inputs: DemoInputs = {};
  const unused = new Map(Object.entries(record.values));
  const take = (blank: DemoBlank, key: string) => {
    const value = unused.get(key)!;
    unused.delete(key);
    inputs[blank.name] = blank.kind === "toggle" ? (YES.has(value.trim().toLowerCase()) ? "yes" : "no") : value;
  };
  for (const blank of blanks) {
    const wanted = new Set([joined(blank.name), joined(blank.label)]);
    const key = [...unused.keys()].find((candidate) => wanted.has(joined(candidate)));
    if (key !== undefined) take(blank, key);
  }
  // A shorter key ("amount" for amount_usd) is taken only when one blank still without a value could be meant.
  for (const key of Array.from(unused.keys())) {
    const words = tokens(key);
    if (!words.length) continue;
    const fits = blanks.filter((blank) => !(blank.name in inputs) && [blank.name, blank.label].some((text) => { const have = tokens(text); return words.every((word) => have.includes(word)); }));
    if (fits.length === 1) take(fits[0]!, key);
  }
  return { inputs, missing: blanks.filter((blank) => !(blank.name in inputs)).map((blank) => blank.name) };
}

export interface InputFolder {
  records: InputRecord[];
  skipped: Array<{ file: string; reason: string }>;
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Every record in a folder's own files that holds a value for one of `blanks`, by file name in natural order (expense-2
 * before expense-10). Folders inside it are not read, and neither is a link to a file outside it; `except` leaves out
 * files by name and records by their `source`.
 */
export function readInputFolder(folder: string, blanks: readonly DemoBlank[], options: { except?: readonly string[] } = {}): InputFolder {
  const found: InputFolder = { records: [], skipped: [] };
  const root = resolve(folder);
  if (!existsSync(root) || !statSync(root).isDirectory()) return found;
  const except = new Set(options.except ?? []);
  let realRoot = root;
  try { realRoot = realpathSync(root); } catch {}
  const names = readdirSync(root).filter((name) => !name.startsWith(".") && EXTENSIONS.has(extname(name).toLowerCase()) && !except.has(name)).sort(natural.compare);
  for (const name of names) {
    const path = join(root, name);
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(path); } catch { continue; }
    if (!stat.isFile()) continue;
    let outside = true;
    try { const away = relative(realRoot, realpathSync(path)); outside = !away || away.startsWith("..") || isAbsolute(away); } catch {}
    if (outside) {
      found.skipped.push({ file: name, reason: `${name} is a link to a file outside the folder.` });
      continue;
    }
    if (stat.size > INPUT_FILE_MAX_BYTES) {
      found.skipped.push({ file: name, reason: `${name} is larger than ${INPUT_FILE_MAX_BYTES / 1024 / 1024} MB.` });
      continue;
    }
    const parsed = parseInputText(name, readFileSync(path, "utf8"));
    if ("error" in parsed) {
      found.skipped.push({ file: name, reason: parsed.error });
      continue;
    }
    const matching = parsed.filter((record) => blanks.length === 0 || Object.keys(matchInputs(blanks, record).inputs).length > 0);
    const useful = matching.filter((record) => !except.has(record.source));
    if (!matching.length) {
      found.skipped.push({ file: name, reason: `${name} holds no value for this skill's inputs.` });
      continue;
    }
    for (const record of useful) {
      if (found.records.length >= INPUT_RECORDS_MAX) break;
      found.records.push({ ...record, folder: root });
    }
  }
  return found;
}
