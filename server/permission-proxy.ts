// MCP stdio server the claude CLI spawns for --permission-prompt-tool; forwards each ask to the server's broker over a unix socket.
// stdout is the MCP channel: never console.log here.
import { createPermissionMcp } from "./permission-mcp.ts";

const server = createPermissionMcp({
  socketPath: process.argv[2] ?? "",
  toolScope: process.env.DUSK_PERMISSION_TOOL_SCOPE === undefined
    ? undefined : (() => { try { return JSON.parse(process.env.DUSK_PERMISSION_TOOL_SCOPE); } catch { return null; } })(),
});

const send = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + "\n");

let inBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inBuf += chunk;
  let nl;
  while ((nl = inBuf.indexOf("\n")) !== -1) {
    const line = inBuf.slice(0, nl);
    inBuf = inBuf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      void server.answer(JSON.parse(line)).then((reply) => { if (reply !== undefined) send(reply); });
    } catch {
    }
  }
});
process.stdin.on("end", () => process.exit(0));
