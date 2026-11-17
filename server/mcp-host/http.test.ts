import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { McpHost, MCP_HOST_PATH } from "./host.ts";
import { createMcpHostRoutes } from "./http.ts";

type Reply = { status: number; type: string | null; text: string };

describe("the MCP host's HTTP transport", () => {
  let host: McpHost;
  let server: Server;
  let dweb: Server;
  let origin: string;
  let release: () => void;
  const runs: string[] = [];

  beforeEach(async () => {
    host = new McpHost();
    let releaseRun: () => void = () => {};
    release = () => releaseRun();
    dweb = createServer((req, res) => {
      runs.push(req.url ?? "");
      if (req.url === "/ping") return res.end(JSON.stringify({ status: "ok", server: "fixture" }));
      if (req.url === "/api/opencode/run") {
        req.resume();
        releaseRun = () => res.end(JSON.stringify({ output: "ran" }));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((resolve) => dweb.listen(0, "127.0.0.1", resolve));
    const routes = createMcpHostRoutes(host, { keepAliveMs: 20, streamAfterMs: 50 });
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void routes({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: {} as never, json, readBody })
        .then((out) => { if (!res.headersSent) { res.statusCode = 404; res.end(); } return out; })
        .catch((error: { status?: number }) => { if (!res.headersSent) { res.statusCode = error.status ?? 500; res.end(); } });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    host.listening((server.address() as AddressInfo).port);
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    runs.length = 0;
  });

  afterEach(async () => {
    release();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => dweb.close(resolve));
    vi.restoreAllMocks();
  });

  const mountDweb = (threadId = "t1") => host.entry(host.lease(), {
    threadId, name: "dweb", server: { kind: "dweb", url: `http://127.0.0.1:${(dweb.address() as AddressInfo).port}` },
  });

  async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Reply> {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
  }

  it("answers the mount a bearer names, and the same refusal for every bearer that names none", async () => {
    const mount = mountDweb();
    const other = host.entry(host.lease(), { threadId: "t1", name: "dusk", server: { kind: "permission", socketPath: null } });
    const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const ok = await post(mount.url, mount.headers, list);
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text).result.tools.map((tool: { name: string }) => tool.name)).toContain("dweb_status");
    const refusals = await Promise.all([
      post(mount.url, {}, list),
      post(mount.url, { authorization: "Bearer nope" }, list),
      post(mount.url, other.headers, list),
      post(`${origin}${MCP_HOST_PATH}dusk`, mount.headers, list),
    ]);
    for (const refusal of refusals) expect(refusal).toMatchObject({ status: 401, text: JSON.stringify({ error: "unauthorized" }) });
  });

  it("speaks Streamable HTTP: version echo, notifications accepted, batches, no server stream", async () => {
    const mount = mountDweb();
    const init = await post(mount.url, mount.headers, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(JSON.parse(init.text).result.protocolVersion).toBe("2025-06-18");
    expect((await post(mount.url, mount.headers, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const batch = await post(mount.url, mount.headers, [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
    expect(JSON.parse(batch.text).map((reply: { id: number }) => reply.id)).toEqual([1, 2]);
    const get = await fetch(mount.url, { headers: mount.headers });
    expect(get.status).toBe(405);
    expect((await fetch(mount.url, { method: "DELETE", headers: mount.headers })).status).toBe(204);
    expect((await post(mount.url, mount.headers, "not a message")).status).toBe(400);
  });

  it("answers a quick tool call as JSON even to a client that takes a stream", async () => {
    const mount = mountDweb();
    const reply = await post(mount.url, { ...mount.headers, accept: "application/json, text/event-stream" },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "dweb_status", arguments: {} } });
    expect(reply.type).toBe("application/json");
    expect(JSON.parse(reply.text).result.content[0].text).toContain("fixture");
  });

  it("streams a slow tool call's answer with keep-alive comments while it runs", async () => {
    const mount = mountDweb();
    const response = await fetch(mount.url, {
      method: "POST", headers: { ...mount.headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "dweb_opencode_run", arguments: { command: "go" } } }),
    });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes(": keep-alive")) text += decoder.decode((await reader.read()).value);
    release();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    const frames = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5)));
    expect(frames).toEqual([{ jsonrpc: "2.0", id: 7, result: { content: [{ type: "text", text: "ran" }], isError: false } }]);
  });

  it("stops answering a mount once its last hold is given back", async () => {
    const lease = host.lease();
    const mount = host.entry(lease, { threadId: "t1", name: "dweb", server: { kind: "dweb", url: "http://127.0.0.1:9" } });
    expect((await post(mount.url, mount.headers, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
    lease.release();
    expect((await post(mount.url, mount.headers, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
  });

  it("never writes a bearer to its answers or the log", async () => {
    const logged: string[] = [];
    for (const method of ["log", "warn", "error", "info"] as const) vi.spyOn(console, method).mockImplementation((...args) => { logged.push(args.join(" ")); });
    const mount = mountDweb();
    const token = mount.headers.Authorization!.slice("Bearer ".length);
    const replies = await Promise.all([
      post(mount.url, mount.headers, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "dweb_status", arguments: {} } }),
      post(mount.url, mount.headers, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "no_such_tool" } }),
      post(mount.url, { authorization: `Bearer ${token}x` }, { jsonrpc: "2.0", id: 3, method: "ping" }),
    ]);
    for (const reply of replies) expect(reply.text).not.toContain(token);
    expect(logged.join("\n")).not.toContain(token);
  });
});
