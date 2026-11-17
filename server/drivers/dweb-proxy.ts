// The dweb MCP server (dweb-mcp.ts) over stdio JSON-RPC 2.0. Env:
//   DWEB_URL  base URL of the local dweb daemon (http://127.0.0.1:49737)
import readline from "node:readline";

import { dwebMcp } from "./dweb-mcp.ts";

type Json = Record<string, unknown>;
const handle = dwebMcp(process.env.DWEB_URL);
const send = (msg: Json) => process.stdout.write(JSON.stringify(msg) + "\n");

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg: Json;
  try {
    msg = JSON.parse(t) as Json;
  } catch {
    return;
  }
  void handle(msg).then((reply) => { if (reply) send(reply); }, (e) => {
    if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: (e as Error).message } });
  });
});
rl.on("close", () => process.exit(0));
