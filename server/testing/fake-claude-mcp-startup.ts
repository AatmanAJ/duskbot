// FAKE_CLAUDE_MCP_STARTUP=1: connect every server of --mcp-config at launch and keep it for the life of the process, as
// Claude Code 2.1 does, so a warm fake engine holds the same MCP children (or HTTP connections) a real one would.
// FAKE_CLAUDE_MCP_STARTUP_LOG appends one JSON line per server: {pid, server, ok, tools, transport, error?}. Like the CLI,
// the first prompt waits until every server has answered its tool list or failed. FAKE_CLAUDE_MCP_CONFIG_DIR keeps a copy
// of the launch's --mcp-config as <dir>/<pid>.json, which the CLI's own file does not outlive.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Entry = { command?: string; args?: string[]; env?: Record<string, string>; type?: string; url?: string; headers?: Record<string, string> };
type Frame = { id?: unknown; result?: { tools?: Array<{ name?: unknown }> }; error?: { message?: unknown } };

const INITIALIZE = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-claude", version: "1" } } };
const INITIALIZED = { jsonrpc: "2.0", method: "notifications/initialized" };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

const children = new Set<ChildProcess>();
const STARTUP_TIMEOUT_MS = 30_000;
const pending = new Set<string>();
let ready: () => void = () => {};

function record(line: { server: string } & Record<string, unknown>): void {
  if (!pending.delete(line.server)) return;
  const path = process.env.FAKE_CLAUDE_MCP_STARTUP_LOG;
  if (path) appendFileSync(path, `${JSON.stringify({ pid: process.pid, ...line })}\n`);
  if (!pending.size) ready();
}

function toolNames(frame: Frame | null | undefined): string[] {
  return (frame?.result?.tools ?? []).map((tool) => String(tool.name)).sort();
}

function connectStdio(name: string, entry: Entry): void {
  const child = spawn(entry.command!, entry.args ?? [], { env: { ...process.env, ...entry.env }, stdio: ["pipe", "pipe", "ignore"] });
  children.add(child);
  child.on("exit", (code) => { children.delete(child); record({ server: name, ok: false, transport: "stdio", error: `exited ${code}` }); });
  child.on("error", (error) => record({ server: name, ok: false, transport: "stdio", error: error.message }));
  let buffer = "";
  let listed = false;
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let frame: Frame;
      try { frame = JSON.parse(line) as Frame; } catch { continue; }
      if (frame.id === 1) {
        child.stdin!.write(`${JSON.stringify(INITIALIZED)}\n${JSON.stringify(LIST)}\n`);
      } else if (frame.id === 2 && !listed) {
        listed = true;
        record({ server: name, ok: !frame.error, transport: "stdio", tools: toolNames(frame), ...(frame.error ? { error: String(frame.error.message) } : {}) });
      }
    }
  });
  child.stdin!.on("error", () => {});
  child.stdin!.write(`${JSON.stringify(INITIALIZE)}\n`);
}

async function connectHttp(name: string, entry: Entry): Promise<void> {
  let session: string | null = null;
  const send = async (body: unknown): Promise<Frame | null> => {
    const response = await fetch(entry.url!, { method: "POST", body: JSON.stringify(body), headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", ...entry.headers, ...(session ? { "mcp-session-id": session } : {}) } });
    session = response.headers.get("mcp-session-id") ?? session;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) return null;
    if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) return JSON.parse(text) as Frame;
    return text.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5)) as Frame).find((frame) => frame.id !== undefined) ?? null;
  };
  try {
    await send(INITIALIZE);
    await send(INITIALIZED);
    const listed = await send(LIST);
    record({ server: name, ok: !listed?.error, transport: "http", tools: toolNames(listed), ...(listed?.error ? { error: String(listed.error.message) } : {}) });
  } catch (error) {
    record({ server: name, ok: false, transport: "http", error: (error as Error).message });
  }
}

export function connectLaunchMcpServers(configPath: string | null): void {
  if (!configPath) return;
  let servers: Record<string, Entry> = {};
  let text: string;
  try { text = readFileSync(configPath, "utf8"); servers = (JSON.parse(text) as { mcpServers?: Record<string, Entry> }).mcpServers ?? {}; } catch { return; }
  if (process.env.FAKE_CLAUDE_MCP_CONFIG_DIR) writeFileSync(join(process.env.FAKE_CLAUDE_MCP_CONFIG_DIR, `${process.pid}.json`), text, { mode: 0o600 });
  const entries = Object.entries(servers).filter(([, entry]) => entry.url || entry.command);
  if (!entries.length) return;
  for (const [name] of entries) pending.add(name);
  process.stdin.pause();
  const timer = setTimeout(() => ready(), STARTUP_TIMEOUT_MS);
  ready = () => { clearTimeout(timer); ready = () => {}; process.stdin.resume(); };
  process.on("exit", () => { for (const child of children) child.kill(); });
  for (const [name, entry] of entries) {
    if (entry.url) void connectHttp(name, entry);
    else connectStdio(name, entry);
  }
}
