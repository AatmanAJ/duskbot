import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanProbe } from "./routine-quiet.ts";
import { saveScriptOutput, savedText, SAVED_MAX_BYTES } from "./routine-save.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), "dusk-save-")); dirs.push(dir); return dir; };

describe("a script check's save_to", () => {
  it("is a plain path inside the bot's folder, never its memory, personality or skills", () => {
    expect(cleanProbe({ kind: "script", url: "", command: "x", saveTo: "./reports/prices.md", saveMode: "append" })).toMatchObject({ saveTo: "reports/prices.md", saveMode: "append" });
    for (const bad of ["../out.md", "/etc/x", "a/../../b", ".jobs/x", "MEMORY.md", "memory/notes.md", "SOUL.md", "skills/x/SKILL.md", "a//b", "c:\\x"]) {
      expect(() => cleanProbe({ kind: "script", url: "", command: "x", saveTo: bad })).toThrow(/save_to/);
    }
    expect(() => cleanProbe({ kind: "page", url: "https://example.com", saveTo: "a.md" })).toThrow(/only a script check/);
    expect(() => cleanProbe({ kind: "script", url: "", command: "x", saveMode: "append" })).toThrow(/only with save_to/);
  });

  it("replaces the file with each output, without a wakeAgent line", () => {
    const workspace = tempDir();
    expect(savedText("price 4\n{\"wakeAgent\": true}\n")).toBe("price 4");
    expect(saveScriptOutput(workspace, "reports/p.md", "price 4\n{\"wakeAgent\": true}")).toBeNull();
    expect(saveScriptOutput(workspace, "reports/p.md", "price 5")).toBeNull();
    expect(readFileSync(join(workspace, "reports/p.md"), "utf8")).toBe("price 5\n");
    expect(saveScriptOutput(workspace, "reports/p.md", "{\"wakeAgent\": false}")).toBeNull();
    expect(readFileSync(join(workspace, "reports/p.md"), "utf8")).toBe("price 5\n");
  });

  it("appends with a time line and keeps the newest megabyte", () => {
    const workspace = tempDir();
    saveScriptOutput(workspace, "log.md", "one", "append", Date.UTC(2026, 10, 25));
    saveScriptOutput(workspace, "log.md", "two", "append", Date.UTC(2026, 10, 26));
    expect(readFileSync(join(workspace, "log.md"), "utf8")).toBe("## 2026-11-25T00:00:00.000Z\none\n## 2026-11-26T00:00:00.000Z\ntwo\n");
    saveScriptOutput(workspace, "log.md", "x".repeat(SAVED_MAX_BYTES), "append");
    const kept = readFileSync(join(workspace, "log.md"), "utf8");
    expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(SAVED_MAX_BYTES);
    expect(kept).not.toContain("one");
  });

  it("never follows a link out of the bot's folder", () => {
    const workspace = tempDir(), outside = tempDir();
    mkdirSync(workspace, { recursive: true });
    symlinkSync(outside, join(workspace, "out"));
    expect(saveScriptOutput(workspace, "out/x.md", "secret")).toMatch(/outside/);
    writeFileSync(join(outside, "target.md"), "keep");
    symlinkSync(join(outside, "target.md"), join(workspace, "link.md"));
    expect(saveScriptOutput(workspace, "link.md", "overwrite")).toMatch(/plain file/);
    expect(readFileSync(join(outside, "target.md"), "utf8")).toBe("keep");
    expect(existsSync(join(outside, "x.md"))).toBe(false);
  });
});
