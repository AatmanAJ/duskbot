import type { DemoBlank, DemoReplayItem } from "../../shared/demo-recording.ts";
import type { DemoEngine } from "./compiler.ts";

export interface InputFile {
  name: string;
  content: string;
}

const FILE_LIMIT = 200;
const ROW_LIMIT = 500;
const VALUE_LIMIT = 2_000;
const ASK_CONTENT_LIMIT = 20_000;
const ASK_TIMEOUT_MS = 60_000;
/** How many items of one request the model is asked about; the rest keep their unread blanks as missing. */
const ASK_LIMIT = 40;
const LINE_LIMIT = 2_000;

/** Other words files use for the same thing, so a receipt's "Total" fills an "Amount". */
const ALSO_CALLED: readonly string[][] = [
  ["amount", "total", "sum", "price", "cost", "grand total", "amount due", "total due", "amount paid", "balance due"],
  ["merchant", "vendor", "seller", "sold by", "store", "shop", "payee", "supplier", "company", "business"],
  ["date", "purchased on", "purchase date", "transaction date", "invoice date", "issued", "issued on", "paid on", "day"],
  ["category", "type", "kind", "class", "expense type"],
  ["notes", "note", "memo", "description", "comment", "comments", "details", "reason"],
  ["name", "full name"],
  ["first name", "given name", "forename"],
  ["last name", "surname", "family name"],
  ["email", "e mail", "email address", "mail"],
  ["phone", "phone number", "telephone", "mobile", "tel"],
  ["zip", "zip code", "postal code", "postcode"],
  ["quantity", "qty", "count"],
  ["invoice number", "invoice", "invoice no", "invoice id", "reference", "ref", "number"],
  ["title", "subject", "headline"],
  ["address", "street", "street address"],
];

const norm = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[^A-Za-z0-9]+/g, " ").trim().toLowerCase();

function namesOf(blank: DemoBlank): { own: string[]; also: string[] } {
  const own = [...new Set([norm(blank.name), norm(blank.label)])].filter(Boolean);
  const also = ALSO_CALLED.filter((group) => group.some((word) => own.includes(word))).flat();
  return { own, also };
}

function cleaned(raw: string, blank: DemoBlank): string {
  const value = raw.trim().slice(0, VALUE_LIMIT);
  if (blank.kind === "number") {
    const bare = value.replace(/[$€£¥\s]/g, "").replace(/(\d),(?=\d{3}\b)/g, "$1");
    return /^[-+]?\d+(\.\d+)?%?$/.test(bare) ? bare : value;
  }
  if (blank.kind === "choice" && blank.choices?.length) {
    return blank.choices.find((choice) => choice.trim().toLowerCase() === value.toLowerCase()) ?? value;
  }
  return value;
}

type Pairs = Array<[key: string, value: string]>;

/** The values of each non-secret blank the pairs give, and the blanks they do not. */
function matched(pairs: Pairs, blanks: readonly DemoBlank[]): { values: Record<string, string>; missing: string[] } {
  const open = pairs.map(([key, value]) => ({ key: norm(key), value, used: false })).filter((pair) => pair.key && pair.value.trim());
  const values: Record<string, string> = {};
  const wanted = blanks.filter((blank) => blank.kind !== "secret");
  const take = (blank: DemoBlank, names: string[]) => {
    if (Object.hasOwn(values, blank.name)) return;
    const pair = open.find((each) => !each.used && names.includes(each.key));
    if (!pair) return;
    pair.used = true;
    values[blank.name] = cleaned(pair.value, blank);
  };
  for (const blank of wanted) take(blank, namesOf(blank).own);
  for (const blank of wanted) take(blank, namesOf(blank).also);
  return { values, missing: wanted.filter((blank) => !Object.hasOwn(values, blank.name)).map((blank) => blank.name) };
}

function textPairs(content: string): Pairs {
  const pairs: Pairs = [];
  for (const line of content.split(/\r?\n/)) {
    if (line.length > LINE_LIMIT) continue;
    const labelled = /^\s*([A-Za-z][A-Za-z0-9 _./#-]{0,40}?)\s*[:=]\s*(\S.*)$/.exec(line);
    if (labelled) {
      pairs.push([labelled[1]!, labelled[2]!]);
      continue;
    }
    const columns = /^\s*([A-Za-z][A-Za-z ]{0,30}?)\s{2,}([$€£¥]?\s?\d[\d.,]*\S*)\s*$/.exec(line);
    if (columns) pairs.push([columns[1]!, columns[2]!]);
  }
  return pairs;
}

function jsonPairs(value: unknown, prefix = ""): Pairs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const pairs: Pairs = [];
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner === "string" || typeof inner === "number" || typeof inner === "boolean") pairs.push(...(prefix ? [[`${prefix}${key}`, String(inner)] as [string, string]] : []), [key, String(inner)]);
    else if (inner && typeof inner === "object" && !Array.isArray(inner) && !prefix) pairs.push(...jsonPairs(inner, `${key} `));
  }
  return pairs;
}

/** Rows of a delimited table, quotes as in RFC 4180. */
function tableRows(content: string): string[][] {
  const header = content.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((each) => [each, header.split(each).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let at = 0; at < content.length; at++) {
    const char = content[at]!;
    if (quoted) {
      if (char === "\"" && content[at + 1] === "\"") { cell += "\""; at++; }
      else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"" && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && content[at + 1] === "\n") at++;
      row.push(cell);
      cell = "";
      if (row.some((each) => each.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((each) => each.trim())) rows.push(row);
  return rows;
}

interface Source {
  label: string;
  pairs: Pairs;
  /** What the model reads when the labels leave a blank unfilled. */
  text: string;
}

function sourcesOf(file: InputFile): Source[] {
  const name = file.name.slice(0, 200);
  const content = file.content;
  if (/\.(csv|tsv)$/i.test(name)) {
    const [header, ...rows] = tableRows(content);
    if (!header) return [];
    return rows.slice(0, ROW_LIMIT).map((row, index) => ({
      label: `${name} row ${index + 1}`,
      pairs: header.map((key, column): [string, string] => [key, row[column] ?? ""]),
      text: header.map((key, column) => `${key}: ${row[column] ?? ""}`).join("\n"),
    }));
  }
  if (/\.json$/i.test(name) || /^\s*[[{]/.test(content)) {
    try {
      const parsed = JSON.parse(content) as unknown;
      if (Array.isArray(parsed)) return parsed.slice(0, ROW_LIMIT).map((item, index) => ({ label: `${name} item ${index + 1}`, pairs: jsonPairs(item), text: JSON.stringify(item, null, 2) }));
      return [{ label: name, pairs: jsonPairs(parsed), text: content }];
    } catch {
      return [{ label: name, pairs: textPairs(content), text: content }];
    }
  }
  return [{ label: name, pairs: textPairs(content), text: content }];
}

function jsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1]! : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function askPrompt(source: Source, wanted: readonly DemoBlank[]): string {
  return [
    "Read the file below and find these values in it. Answer with JSON only: one object with exactly these keys. Use null for a value the file does not give; never guess.",
    "",
    ...wanted.map((blank) => `- ${blank.name} (${blank.label}): ${blank.kind === "choice" && blank.choices?.length ? `one of ${blank.choices.join(", ")}` : blank.kind}${blank.example ? `, for example ${JSON.stringify(blank.example.slice(0, 120))}` : ""}`),
    "",
    `File ${source.label}:`,
    source.text.slice(0, ASK_CONTENT_LIMIT),
  ].join("\n");
}

/**
 * The values each file gives a plan's blanks: one item for a file, or one for each row of a CSV. Labelled values are
 * read as written; what is left is asked of the model when there is one, and listed as missing otherwise.
 */
export async function readDemoInputs(files: readonly InputFile[], blanks: readonly DemoBlank[], deps: { engine?: DemoEngine | null } = {}): Promise<DemoReplayItem[]> {
  const items: DemoReplayItem[] = [];
  let asked = 0;
  for (const file of files.slice(0, FILE_LIMIT)) {
    for (const source of sourcesOf(file)) {
      const { values, missing } = matched(source.pairs, blanks);
      let left = missing;
      if (left.length && deps.engine && asked < ASK_LIMIT) {
        asked++;
        const wanted = blanks.filter((blank) => left.includes(blank.name));
        const answer = await deps.engine.generateText(askPrompt(source, wanted), { timeoutMs: ASK_TIMEOUT_MS }).then(jsonObject, () => null);
        for (const blank of wanted) {
          const found = answer?.[blank.name];
          if ((typeof found === "string" && found.trim()) || typeof found === "number") values[blank.name] = cleaned(String(found), blank);
        }
        left = left.filter((name) => !Object.hasOwn(values, name));
      }
      const slug = source.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
      items.push({ id: `${items.length + 1}-${slug || "item"}`, label: source.label, values, missing: left });
    }
  }
  return items;
}
