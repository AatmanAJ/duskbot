// An MCP client for the fake engines: one connection to a server of an engine's --mcp-config, a stdio command or an
// HTTP mount (Streamable HTTP, a JSON or event-stream answer), as Claude Code makes either.
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

import { waitForExit } from "./cleanup.ts";

export type McpEntry = { command?: string; args?: string[]; env?: Record<string, string>; type?: string; url?: string; headers?: Record<string, string> };
export type McpFrame = { id?: unknown; result?: any; error?: { code?: number; message?: string } };

export interface McpConnection {
  call(method: string, params?: unknown): Promise<McpFrame>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
  /** Fires once if the server goes away (a stdio child exits). */
  onFailure(listener: (error: Error) => void): void;
}

export function isHttpEntry(entry: McpEntry | undefined): entry is McpEntry & { url: string } {
  return typeof entry?.url === "string";
}

function httpConnection(entry: McpEntry & { url: string }): McpConnection {
  let session: string | null = null;
  let serial = 0;
  const post = async (body: unknown): Promise<McpFrame | null> => {
    const response = await fetch(entry.url, { method: "POST", body: JSON.stringify(body), headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", ...entry.headers, ...(session ? { "mcp-session-id": session } : {}) } });
    session = response.headers.get("mcp-session-id") ?? session;
    const text = await response.text();
    if (!response.ok) throw new Error(`the MCP server answered HTTP ${response.status}: ${text.slice(0, 200)}`);
    if (!text.trim()) return null;
    if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) return JSON.parse(text) as McpFrame;
    return text.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5)) as McpFrame).find((frame) => frame.id !== undefined) ?? null;
  };
  return {
    call: async (method, params = {}) => (await post({ jsonrpc: "2.0", id: ++serial, method, params })) ?? { error: { message: "no answer" } },
    notify: async (method, params) => { await post({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }); },
    close: async () => {},
    onFailure: () => {},
  };
}

function stdioConnection(entry: McpEntry): McpConnection {
  const child: ChildProcess = spawn(entry.command!, entry.args ?? [], { env: { ...process.env, ...entry.env }, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr!.resume();
  const pending = new Map<number, { resolve: (frame: McpFrame) => void; reject: (error: Error) => void }>();
  const listeners: Array<(error: Error) => void> = [];
  let serial = 0;
  let closing = false;
  let failure: Error | undefined;
  const fail = (error: Error) => {
    if (closing || failure) return;
    failure = error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    for (const listener of listeners) listener(error);
  };
  createInterface({ input: child.stdout! }).on("line", (line) => {
    let frame: McpFrame;
    try { frame = JSON.parse(line) as McpFrame; } catch { fail(new Error("Fixture MCP returned malformed JSON")); return; }
    const waiter = typeof frame.id === "number" ? pending.get(frame.id) : undefined;
    if (!waiter) return;
    pending.delete(frame.id as number);
    waiter.resolve(frame);
  });
  child.on("error", fail);
  child.on("exit", (code, signal) => fail(new Error(`Fixture MCP exited unexpectedly: ${signal ?? code}`)));
  child.stdin!.on("error", fail);
  const write = (message: unknown) => child.stdin!.write(`${JSON.stringify(message)}\n`);
  return {
    call: (method, params = {}) => new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      const id = ++serial;
      pending.set(id, { resolve, reject });
      write({ jsonrpc: "2.0", id, method, params });
    }),
    notify: async (method, params) => { write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }); },
    close: async () => {
      closing = true;
      child.stdin!.destroy();
      await waitForExit(child, { signal: "SIGTERM", graceMs: 500 });
    },
    onFailure: (listener) => { listeners.push(listener); },
  };
}

export function openMcp(entry: McpEntry): McpConnection {
  return isHttpEntry(entry) ? httpConnection(entry) : stdioConnection(entry);
}

/** initialize, then one request, then close: how the fakes call a server they don't keep. */
export async function mcpRequest(entry: McpEntry, method: string, params: unknown): Promise<McpFrame> {
  const connection = openMcp(entry);
  try {
    await connection.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "claude-code", version: "fixture" } });
    return await connection.call(method, params);
  } finally {
    await connection.close();
  }
}
