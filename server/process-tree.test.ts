import { describe, expect, it } from "vitest";

import { descendants, parseProcStat, parsePsTable, parseWindowsTable, processTable, treeSize } from "./process-tree.ts";

describe("process trees", () => {
  it("reads Linux's stat line, whatever the command's name holds", () => {
    const stat = "4242 (node (mcp) x) S 4241 4242 4242 0 -1 4194560 100 0 0 0 1 2 0 0 20 0 7 0 12345 1000000 2560 18446744073709551615";
    expect(parseProcStat(stat)).toEqual({ pid: 4242, ppid: 4241, rssBytes: 2560 * 4096, name: "node (mcp) x" });
    expect(parseProcStat("garbage")).toBeNull();
  });

  it("reads ps's table on macOS and Linux, and PowerShell's CSV on Windows", () => {
    expect(parsePsTable("  101     1  20480 /usr/bin/claude code\n  102   101   4096 node\nbad line\n")).toEqual([
      { pid: 101, ppid: 1, rssBytes: 20480 * 1024, name: "/usr/bin/claude code" },
      { pid: 102, ppid: 101, rssBytes: 4096 * 1024, name: "node" },
    ]);
    const csv = '"ProcessId","ParentProcessId","WorkingSetSize","Name"\r\n"101","4","20971520","claude.exe"\r\n"102","101","4194304","node ""x"".exe"\r\n';
    expect(parseWindowsTable(csv)).toEqual([
      { pid: 101, ppid: 4, rssBytes: 20971520, name: "claude.exe" },
      { pid: 102, ppid: 101, rssBytes: 4194304, name: "node \"x\".exe" },
    ]);
  });

  it("sums a process and everything under it, and nothing beside it", () => {
    const rows = [
      { pid: 1, ppid: 0, rssBytes: 1, name: "init" },
      { pid: 10, ppid: 1, rssBytes: 100, name: "engine" },
      { pid: 11, ppid: 10, rssBytes: 20, name: "mcp" },
      { pid: 12, ppid: 11, rssBytes: 3, name: "grandchild" },
      { pid: 20, ppid: 1, rssBytes: 999, name: "other" },
      { pid: 30, ppid: 30, rssBytes: 5, name: "own parent" },
    ];
    expect(descendants(rows, 10).map((row) => row.pid)).toEqual([10, 11, 12]);
    expect(treeSize(rows, 10)).toEqual({ processes: 3, rssBytes: 123 });
    expect(treeSize(rows, 404)).toEqual({ processes: 0, rssBytes: 0 });
  });

  it("finds this process in the live table", async () => {
    const rows = await processTable();
    expect(rows).not.toBeNull();
    const size = treeSize(rows!, process.pid);
    expect(size.processes).toBeGreaterThanOrEqual(1);
    expect(size.rssBytes).toBeGreaterThan(0);
  });
});
