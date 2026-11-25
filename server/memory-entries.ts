// MEMORY.md entry grammar: `- YYYY-MM-DD · from <source> · text[ · until YYYY-MM-DD]`, struck through when superseded.

export const UNTIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATED = /^(- (\d{4}-\d{2}-\d{2}) · (?:from [^·\n]* · )?)(.*)$/;
const UNTIL_MARK = / · until (\d{4}-\d{2}-\d{2})(?= · |$)/;
const TRAILING_MARKS = /(?: · (?:updated|confirmed|until|expired|superseded|merged|moved) \d{4}-\d{2}-\d{2})+$/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
/** A safety or health fact always loads: neither organize nor the size rule moves one out of MEMORY.md. */
const ALWAYS_CORE = /\b(?:allerg\w*|anaphyla\w*|intoleran\w*|vegetarian|vegan|halal|kosher|gluten|lactose|co?eliac|diabet\w*|asthma\w*|epilep\w*|pregnan\w*|medicat\w*|disabilit\w*|wheelchair|blind|deaf)\b/i;

export function alwaysCore(body: string): boolean {
  return ALWAYS_CORE.test(body);
}

export interface MemoryEntryLine {
  line: number;
  end: number;
  raw: string;
  prefix: string;
  body: string;
  date: string;
  until: string | null;
  struck: boolean;
}

export function isMemoryDate(value: unknown): value is string {
  if (typeof value !== "string" || !UNTIL_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function untilMark(until: string | undefined): string {
  return until ? ` · until ${until}` : "";
}

const togglesFence = (line: string) => (line.match(/```/g)?.length ?? 0) % 2 === 1;

/** Undated hand-written lines are not entries and upkeep never touches them. */
export function parseMemoryEntries(text: string): MemoryEntryLine[] {
  const out: MemoryEntryLine[] = [];
  const lines = text.split("\n");
  for (let line = 0; line < lines.length;) {
    const raw = lines[line];
    const m = DATED.exec(raw);
    if (!m) {
      line += 1;
      continue;
    }
    let open = togglesFence(raw);
    let end = line + 1;
    for (let next = line + 1; next < lines.length && !DATED.test(lines[next]); next += 1) {
      if (!open && !/^[ \t]/.test(lines[next]) && !lines[next].startsWith("```")) break;
      if (togglesFence(lines[next])) open = !open;
      if (!open) end = next + 1;
    }
    const rest = m[3];
    const struck = rest.startsWith("~~");
    const until = UNTIL_MARK.exec(rest)?.[1] ?? null;
    const body = rest.replace(TRAILING_MARKS, "").replace(/^~~/, "").replace(/~~$/, "").trim();
    out.push({ line, end, raw, prefix: m[1], body, date: m[2], until, struck });
    line = end;
  }
  return out;
}

export function isExpired(entry: Pick<MemoryEntryLine, "until" | "struck">, today: string): boolean {
  return !entry.struck && entry.until !== null && entry.until < today;
}

export function withoutExpired(text: string, today: string): { text: string; hidden: number } {
  const expired = new Set(parseMemoryEntries(text).filter((e) => isExpired(e, today)).map((e) => e.line));
  if (!expired.size) return { text, hidden: 0 };
  return { text: text.split("\n").filter((_, index) => !expired.has(index)).join("\n"), hidden: expired.size };
}

/** Deliberately narrow: `-10` and `10`, `C++` and `C`, `API_KEY` and `api_key` stay different facts. */
export function factIdentity(text: string): string {
  return text
    .normalize("NFC")
    .replace(BULLET, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "")
    .trim();
}

export function lineFactIdentity(line: string): string {
  const entry = parseMemoryEntries(line)[0];
  if (entry) return entry.struck ? "" : factIdentity(entry.body);
  return factIdentity(line.replace(/~~/g, ""));
}

export function notebookIdentities(text: string): Set<string> {
  return new Set(text.split("\n").map(lineFactIdentity).filter(Boolean));
}

export function withoutSuperseded(text: string): string {
  const dropped = new Set<number>();
  for (const entry of parseMemoryEntries(text)) {
    if (entry.struck) for (let line = entry.line; line < entry.end; line++) dropped.add(line);
  }
  return text.split("\n").filter((_, index) => !dropped.has(index)).join("\n");
}

/** Case, width, curly quotes and spacing aside, so a passage matches however the note was typed. */
export function foldForMatch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim();
}

/** Whether a note mentions `passage` as whole words ("IST" is not in "dentist"); null for a passage too short to name anything. */
export function passageMatcher(passage: string): ((text: string) => boolean) | null {
  const folded = foldForMatch(passage);
  if ((folded.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 3) return null;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${folded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
  return (text) => pattern.test(foldForMatch(text));
}

const TRACE_STOP = new Set("about after again always another around because before between people person prefers really should something someone thing things through though whether without working morning mornings evening weekend weekends remember reminder reminders".split(" "));

/** Whether a line names one of these forgotten facts: two of a fact's telling words (a name, a number, a long word), or
 * its only one, appear in it. Null when no fact has a telling word. */
export function traceMatcher(texts: readonly string[]): ((text: string) => boolean) | null {
  const perFact: Array<{ terms: Array<(text: string) => boolean>; need: number }> = [];
  for (const text of texts) {
    const words = new Set<string>();
    text.split(/\s+/).forEach((raw, index) => {
      const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      const folded = foldForMatch(word);
      if (folded.length < 3 || TRACE_STOP.has(folded)) return;
      const named = index > 0 && /^\p{Lu}/u.test(word);
      if (named || (/\p{N}/u.test(word) && /\p{L}/u.test(word)) || folded.length >= 6) words.add(folded);
    });
    const terms = [...words].map(passageMatcher).filter((match): match is (text: string) => boolean => match !== null);
    if (terms.length) perFact.push({ terms, need: Math.min(2, terms.length) });
  }
  if (!perFact.length) return null;
  return (line) => perFact.some(({ terms, need }) => terms.filter((matches) => matches(line)).length >= need);
}
