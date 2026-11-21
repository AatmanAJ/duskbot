// One case's mocked tools as a stdio MCP server, so a real engine CLI can play the case: every call is answered from the
// case's world and appended to TASK_WORLD_LOG; nothing outside this process is touched.
// Run: node --experimental-strip-types server/task-fidelity/mcp-world.ts <case id>
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { CASES } from "./cases.ts";
import { answer, worldTools } from "./world.ts";

const found = CASES.find((c) => c.id === process.argv[2]);
if (!found) throw new Error(`no case ${process.argv[2]}`);
const c = found;
const log = process.env.TASK_WORLD_LOG;
const tools = worldTools(c.world).map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));

const page: { url?: string } = {};
const reply = (id: unknown, result: unknown) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  let message: { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } };
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  if (message.method === "initialize") reply(message.id, { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "world", version: "1" } });
  else if (message.method === "tools/list") reply(message.id, { tools });
  else if (message.method === "tools/call") {
    const call = { name: String(message.params?.name ?? ""), input: message.params?.arguments ?? {} };
    const text = answer(c.world, call, page);
    if (log) appendFileSync(log, `${JSON.stringify({ at: Date.now(), call, result: text })}\n`);
    reply(message.id, { content: [{ type: "text", text }] });
  } else reply(message.id, {});
});
