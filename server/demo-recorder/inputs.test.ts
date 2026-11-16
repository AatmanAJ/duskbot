import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DemoBlank } from "../../shared/demo-recording.ts";
import { matchInputs, parseInputText, readInputFolder, type InputRecord } from "./inputs.ts";
import { EXPENSES, INBOX } from "./testing/scenario.ts";

const cleanup: string[] = [];
afterEach(() => { for (const folder of cleanup.splice(0)) rmSync(folder, { recursive: true, force: true }); });

const BOM = String.fromCharCode(0xfeff);

const BLANKS: DemoBlank[] = [
  { name: "report_date", label: "Report date", example: "11/03/2026", kind: "text" },
  { name: "merchant", label: "Merchant", example: "Blue Bottle Coffee", kind: "text" },
  { name: "category", label: "Category", example: "Meals", kind: "choice" },
  { name: "amount_usd", label: "Amount (USD)", example: "18.40", kind: "text" },
  { name: "paid_with", label: "Paid with", example: "Company card", kind: "choice" },
  { name: "billable", label: "Billable to client", example: "yes", kind: "toggle" },
  { name: "notes", label: "Notes", example: "Coffee", kind: "text" },
  { name: "receipt", label: "Receipt", example: "receipt-01.txt", kind: "file" },
];

function records(fileName: string, text: string): InputRecord[] {
  const parsed = parseInputText(fileName, text);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

describe("reading the values for a run from a file", () => {
  it("reads one record from a JSON object and one from each row of a JSON list", () => {
    expect(records("expense-07.json", '{"Merchant": "Caltrain", "Amount (USD)": 16.5, "billable": true, "tags": ["a"], "meta": {"x": 1}, "empty": null}')).toEqual([
      { source: "expense-07.json", values: { Merchant: "Caltrain", "Amount (USD)": "16.5", billable: "yes" } },
    ]);
    const rows = records("trips.json", '[{"merchant": "Lyft"}, {"merchant": "Uber", "billable": false}]');
    expect(rows.map((row) => row.source)).toEqual(["trips.json row 1", "trips.json row 2"]);
    expect(rows[1]!.values).toEqual({ merchant: "Uber", billable: "no" });
  });

  it("reads a table's rows under its header, quotes, Windows line endings and a byte order mark included", () => {
    const csv = BOM + 'Merchant,Amount (USD),Notes\r\n"Souvla, Hayes Valley",34.25,"He said ""thanks"""\r\nLyft,42.15,\r\n\r\n';
    expect(records("week.csv", csv)).toEqual([
      { source: "week.csv row 1", values: { Merchant: "Souvla, Hayes Valley", "Amount (USD)": "34.25", Notes: 'He said "thanks"' } },
      { source: "week.csv row 2", values: { Merchant: "Lyft", "Amount (USD)": "42.15", Notes: "" } },
    ]);
    expect(records("week.tsv", "merchant\tamount\nLyft\t42.15\n")[0]!.values).toEqual({ merchant: "Lyft", amount: "42.15" });
  });

  it("reads plain Key: value lines, as a list or not, whatever the line endings", () => {
    const text = BOM + "# Expense\r\nReport date: 11/07/2026\r\n- Merchant: FedEx Office\r\n\r\nNotes: Printed handouts: 40 copies\r\n* Amount (USD) :  12.99  \r\n";
    expect(records("expense-09.txt", text)).toEqual([{ source: "expense-09.txt", values: { "Report date": "11/07/2026", Merchant: "FedEx Office", Notes: "Printed handouts: 40 copies", "Amount (USD)": "12.99" } }]);
    expect(records("expense-09.md", text)).toHaveLength(1);
  });

  it("reads a YAML map and a YAML list of maps", () => {
    expect(records("one.yaml", "merchant: Staples\namount: 63.49\nbillable: false\n")[0]!.values).toEqual({ merchant: "Staples", amount: "63.49", billable: "no" });
    expect(records("many.yml", "- merchant: Lyft\n- merchant: Uber\n").map((row) => row.values.merchant)).toEqual(["Lyft", "Uber"]);
  });

  it("says what is wrong with a file it cannot read, naming the file", () => {
    for (const [name, text] of [["broken.json", "{not json"], ["photo.png", "\u0089PNG"], ["empty.txt", "   \n"], ["scalar.json", "42"], ["prose.txt", "Remember to file these by Friday"]] as const) {
      const parsed = parseInputText(name, text);
      expect(parsed).toHaveProperty("error");
      expect((parsed as { error: string }).error).toContain(name);
    }
  });
});

describe("matching a file's values to the skill's blanks", () => {
  const match = (values: Record<string, string>) => matchInputs(BLANKS, { source: "x.json", values });

  it("matches by the blank's name or the field's label, whatever the case and punctuation", () => {
    const { inputs, missing } = match({ "REPORT-DATE": "11/06/2026", Merchant: "Caltrain", category: "Travel", "amount (usd)": "16.50", "Paid With": "Personal card", "Billable to client": "Yes", NOTES: "Day pass", receipt: "receipts/receipt-07.txt", "Approver": "ignored" });
    expect(missing).toEqual([]);
    expect(inputs).toEqual({ report_date: "11/06/2026", merchant: "Caltrain", category: "Travel", amount_usd: "16.50", paid_with: "Personal card", billable: "yes", notes: "Day pass", receipt: "receipts/receipt-07.txt" });
  });

  it("takes a shorter key when only one blank it could mean is left", () => {
    const { inputs, missing } = match({ date: "11/06/2026", merchant: "Caltrain", category: "Travel", amount: "16.50", paid: "Personal card", billable: "no", notes: "", receipt: "r.txt" });
    expect(missing).toEqual([]);
    expect(inputs.report_date).toBe("11/06/2026");
    expect(inputs.amount_usd).toBe("16.50");
    expect(inputs.paid_with).toBe("Personal card");
    expect(inputs.notes).toBe("");
  });

  it("guesses nothing when a key could mean two blanks, and lists what the file left out", () => {
    const blanks: DemoBlank[] = [
      { name: "start_date", label: "Start date", example: "", kind: "text" }, { name: "end_date", label: "End date", example: "", kind: "text" },
      { name: "city", label: "City", example: "", kind: "text" },
    ];
    const { inputs, missing } = matchInputs(blanks, { source: "trip.json", values: { date: "11/06/2026", City: "Seattle" } });
    expect(inputs).toEqual({ city: "Seattle" });
    expect(missing).toEqual(["start_date", "end_date"]);
  });

  it("reads yes and no in the ways people write them", () => {
    for (const [written, read] of [["Yes", "yes"], ["TRUE", "yes"], ["1", "yes"], ["x", "yes"], ["on", "yes"], ["no", "no"], ["False", "no"], ["0", "no"], ["", "no"], ["off", "no"]] as const) {
      expect(match({ billable: written }).inputs.billable, written).toBe(read);
    }
  });
});

describe("reading a folder of input files", () => {
  it("reads the twelve expenses of the inbox in order, leaving out what holds nothing for the skill", () => {
    const { records: found, skipped } = readInputFolder(INBOX, BLANKS);
    expect(found.map((record) => record.source)).toEqual([
      "expense-01.json", "expense-02.json", "expense-03.json", "expense-04.txt", "expense-05.json", "expense-06.json",
      "expense-07.json", "expense-08.json", "expense-09.txt", "expense-10.json", "expense-11.json", "expense-12.json",
    ]);
    expect(skipped.map((entry) => entry.file)).toEqual(["README.md"]);
    found.forEach((record, at) => {
      expect(record.folder).toBe(INBOX.replace(/[\\/]$/u, ""));
      const { inputs, missing } = matchInputs(BLANKS, record);
      expect(missing, record.source).toEqual([]);
      const expense = EXPENSES[at]!;
      expect(inputs).toEqual({
        report_date: expense.date, merchant: expense.merchant, category: expense.category, amount_usd: expense.amount, paid_with: expense.paidWith,
        billable: expense.billable ? "yes" : "no", notes: expense.notes, receipt: `receipts/${expense.receipt}`,
      });
    });
  });

  it("leaves out the files it is told to, and sorts numbers as numbers", () => {
    expect(readInputFolder(INBOX, BLANKS, { except: ["expense-01.json"] }).records).toHaveLength(11);
    const folder = mkdtempSync(join(tmpdir(), "dusk-demo-inputs-"));
    cleanup.push(folder);
    for (const name of ["trip-10.json", "trip-2.json", "trip-1.json"]) writeFileSync(join(folder, name), JSON.stringify({ merchant: name }));
    writeFileSync(join(folder, "broken.json"), "{");
    mkdirSync(join(folder, "nested"));
    writeFileSync(join(folder, "nested", "trip-3.json"), JSON.stringify({ merchant: "nested" }));
    const { records: found, skipped } = readInputFolder(folder, BLANKS);
    expect(found.map((record) => record.source)).toEqual(["trip-1.json", "trip-2.json", "trip-10.json"]);
    expect(skipped).toEqual([{ file: "broken.json", reason: expect.stringContaining("broken.json") }]);
    expect(readInputFolder(join(folder, "missing"), BLANKS)).toEqual({ records: [], skipped: [] });
  });
});
