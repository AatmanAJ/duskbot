import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { archivePointer, renderToolArchive, writeToolArchive } from "./compaction-archive.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("saves each folded call's result word for word, secrets masked, and points at the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "dusk-archive-"));
  dirs.push(dir);
  const secret = "sk-ant-api03-" + "b".repeat(40);
  const written = writeToolArchive(dir, "through-m42", [
    { name: "Bash", ok: true, input: '{"command": "psql -c \\"select count(*) from orders\\""}', result: " count \n-------\n 1284\n(1 row)" },
    { name: "Read", ok: false, input: "notes.md", result: `token=${secret}\n\`\`\`fence inside\`\`\`` },
    { name: "WebFetch" },
  ]);
  expect(written).toEqual({ path: join(dir, "context-archive", "through-m42.md"), count: 3 });
  const text = readFileSync(written!.path, "utf8");
  expect(text).toContain("## 1. Bash (ok)");
  expect(text).toContain(" count \n-------\n 1284\n(1 row)");
  expect(text).toContain("## 2. Read (failed)");
  expect(text).not.toContain(secret);
  expect(text).toContain("````\ntoken=");
  expect(text).toContain("## 3. WebFetch (no result recorded)\nResult: none recorded");
  expect(statSync(written!.path).mode & 0o777).toBe(0o600);
  expect(archivePointer(written!)).toBe(`- ${written!.path}: 3 tool results from before this point, word for word. Read or search it with your file tools when an exact earlier result matters.`);
});

it("writes nothing without calls and refuses a name that leaves the folder", () => {
  expect(writeToolArchive("/nonexistent", "x", [])).toBeNull();
  expect(() => writeToolArchive(tmpdir(), "../escape", [{ name: "Bash" }])).toThrow("invalid archive name");
});

it("keeps the file bounded", () => {
  const text = renderToolArchive(Array.from({ length: 80 }, (_, i) => ({ name: `call ${i}`, ok: true, result: "y".repeat(30_000) })));
  expect(text.length).toBeLessThan(1_100_000);
  expect(text).toMatch(/\[\d+ later calls did not fit in this file\]/);
});
