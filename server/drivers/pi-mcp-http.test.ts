// Pi's MCP extension reaching one of dusk bot's own servers as a mount of the harness's MCP host: no process, the
// same list and call as over stdio, and a revoked mount refused.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { McpHost } from "../mcp-host/host.ts";
import { createMcpHostRoutes } from "../mcp-host/http.ts";
import { StdioMcp } from "./pi-mcp-extension.ts";

describe("Pi's MCP extension over the MCP host", () => {
  let host: McpHost;
  let server: Server;

  beforeEach(async () => {
    host = new McpHost();
    const routes = createMcpHostRoutes(host);
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void routes({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: {} as never, json, readBody })
        .then(() => { if (!res.headersSent) { res.statusCode = 404; res.end(); } });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    host.listening((server.address() as AddressInfo).port);
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("lists and calls a mount's tools, and fails once the mount is given back", async () => {
    const lease = host.lease();
    const mount = host.entry(lease, { threadId: "pi-1", name: "dusk", server: { kind: "permission", socketPath: null } });
    const client = new StdioMcp(mount);
    await client.init();
    expect((await client.listTools()).map((tool) => tool.name)).toEqual(["approve", "ask_user"]);
    const asked = await client.callTool("ask_user", { question: "Ship it?" });
    expect(asked.isError).toBe(true);
    expect(JSON.stringify(asked.content)).toContain("could not show this question");
    lease.release();
    await expect(client.callTool("ask_user", { question: "Again?" })).rejects.toThrow(/HTTP 401/);
    client.dispose();
  });
});
