// Resident memory of a process and everything it started, on every platform the app ships on.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export interface ProcessRow {
  pid: number;
  ppid: number;
  rssBytes: number;
  name: string;
}

const PAGE_BYTES = 4096;
const TABLE_TIMEOUT_MS = 10_000;

/** /proc/<pid>/stat: pid (comm) state ppid …, rss in pages the 24th field; comm may hold spaces and parentheses. */
export function parseProcStat(stat: string): ProcessRow | null {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const pid = Number(stat.slice(0, open).trim());
  const fields = stat.slice(close + 2).split(" ");
  const ppid = Number(fields[1]);
  const rssPages = Number(fields[21]);
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) return null;
  return { pid, ppid, rssBytes: Number.isFinite(rssPages) ? rssPages * PAGE_BYTES : 0, name: stat.slice(open + 1, close) };
}

/** `ps -A -o pid=,ppid=,rss=,comm=`: rss in KiB; comm is the rest of the line and may hold spaces. */
export function parsePsTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), rssBytes: Number(match[3]) * 1024, name: match[4]!.trim() });
  }
  return rows;
}

/** Windows PowerShell 5.1's ConvertTo-Csv of Win32_Process: a quoted header line, then one quoted row per process. */
export function parseWindowsTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((cell) => cell[1]!.replace(/""/g, "\""));
    if (cells.length < 4 || !/^\d+$/.test(cells[0]!)) continue;
    rows.push({ pid: Number(cells[0]), ppid: Number(cells[1]), rssBytes: Number(cells[2]) || 0, name: cells[3]! });
  }
  return rows;
}

function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: TABLE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : stdout);
    });
  });
}

const WINDOWS_TABLE = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,Name | ConvertTo-Csv -NoTypeInformation";

/** Every process this user can see, or null when the table can't be read. */
export async function processTable(platform: NodeJS.Platform = process.platform): Promise<ProcessRow[] | null> {
  if (platform === "linux") {
    let pids: string[];
    try { pids = readdirSync("/proc"); } catch { return null; }
    const rows: ProcessRow[] = [];
    for (const pid of pids) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const row = parseProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
        if (row) rows.push(row);
      } catch {}
    }
    return rows;
  }
  if (platform === "win32") {
    const text = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_TABLE]);
    return text === null ? null : parseWindowsTable(text);
  }
  const text = await run("/bin/ps", ["-A", "-o", "pid=,ppid=,rss=,comm="]);
  return text === null ? null : parsePsTable(text);
}

/** `root` and every process descended from it. A pid that Windows reused for an unrelated process can join a tree its
 * dead parent once led; the cost is an overcount, never a missed engine. */
export function descendants(rows: readonly ProcessRow[], root: number): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    if (row.pid === row.ppid) continue;
    const list = children.get(row.ppid);
    if (list) list.push(row); else children.set(row.ppid, [row]);
  }
  const self = rows.find((row) => row.pid === root);
  const found: ProcessRow[] = self ? [self] : [];
  const seen = new Set<number>([root]);
  const queue = [root];
  while (queue.length) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

export interface TreeSize {
  processes: number;
  rssBytes: number;
}

export function treeSize(rows: readonly ProcessRow[], root: number): TreeSize {
  const tree = descendants(rows, root);
  return { processes: tree.length, rssBytes: tree.reduce((sum, row) => sum + row.rssBytes, 0) };
}
