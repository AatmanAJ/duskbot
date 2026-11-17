import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { DemoBlank } from "../../shared/demo-recording.ts";
import { parseInputText, readInputFolder } from "./inputs.ts";

const cleanup: string[] = [];
afterEach(() => { for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const values = (name: string, text: string) => {
  const parsed = parseInputText(name, text);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.map((record) => record.values);
};
const AMOUNT: DemoBlank[] = [{ name: "amount", label: "Amount", example: "18.40", kind: "text" }];

describe("a value reaches the form as the file wrote it", () => {
  it("keeps a number's own digits in JSON and YAML", () => {
    expect(values("a.json", '{"amount": 18.40, "employee": 742, "billable": true}')).toEqual([{ amount: "18.40", employee: "742", billable: "yes" }]);
    expect(values("a.yaml", "amount: 18.40\nemployee: 00742\nbillable: true\nnotes: \"06\"\nreceipt:\nproject: ~\n")).toEqual([{ amount: "18.40", employee: "00742", billable: "yes", notes: "06" }]);
    expect(values("rows.yml", "- amount: 9.50\n- amount: 1e3\n")).toEqual([{ amount: "9.50" }, { amount: "1e3" }]);
  });

  it("reads a bold key in notes without keeping its marks", () => {
    expect(values("a.md", "# Expense\n\n- **Amount:** 18.40\n**Merchant**: Blue Bottle\nNotes: two ** stars\n")).toEqual([{ Amount: "18.40", Merchant: "Blue Bottle", Notes: "two  stars" }]);
  });

  it("gives a table cell's line breaks the way a page holds them", () => {
    expect(values("a.csv", 'amount,notes\r\n18.40,"first line\r\nsecond line"\r\n')).toEqual([{ amount: "18.40", notes: "first line\nsecond line" }]);
  });
});

describe("the files a folder run reads", () => {
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), "dusk-demo-inputs-"));
    cleanup.push(dir);
    return dir;
  };

  it("leaves out the rows it is told were already run, by the name results gave them", () => {
    const dir = folder();
    writeFileSync(join(dir, "trips.csv"), "amount\n1.00\n2.00\n3.00\n");
    writeFileSync(join(dir, "one.json"), '{"amount": "4.00"}');
    const all = readInputFolder(dir, AMOUNT);
    expect(all.records.map((record) => record.source)).toEqual(["one.json", "trips.csv row 1", "trips.csv row 2", "trips.csv row 3"]);
    const rest = readInputFolder(dir, AMOUNT, { except: ["one.json", "trips.csv row 1", "trips.csv row 2"] });
    expect(rest.records.map((record) => [record.source, record.values.amount])).toEqual([["trips.csv row 3", "3.00"]]);
    expect(rest.skipped).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("does not read a link to a file outside the folder", () => {
    const dir = folder();
    const inbox = join(dir, "inbox");
    mkdirSync(inbox);
    writeFileSync(join(dir, "private.json"), '{"amount": "999.00"}');
    writeFileSync(join(inbox, "real.json"), '{"amount": "1.00"}');
    symlinkSync(join(dir, "private.json"), join(inbox, "linked.json"));
    symlinkSync(join(inbox, "real.json"), join(inbox, "same-folder.json"));
    const read = readInputFolder(inbox, AMOUNT);
    expect(read.records.map((record) => record.source)).toEqual(["real.json", "same-folder.json"]);
    expect(read.skipped).toEqual([{ file: "linked.json", reason: "linked.json is a link to a file outside the folder." }]);
    expect(JSON.stringify(read)).not.toContain("999");
  });
});
