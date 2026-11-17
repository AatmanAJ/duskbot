// The Claude driver with the harness's MCP host listening: dusk bot's own relays reach the engine as HTTP mounts, the
// person's servers stay stdio, approvals still go through mcp__dusk__approve, and a closed session's bearers stop
// working.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../config.ts";
import type { ProviderInstance } from "../contracts.ts";
import { json, readBody } from "../harness/http.ts";
import { mcpHost } from "../mcp-host/host.ts";
import { createMcpHostRoutes } from "../mcp-host/http.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { ClaudeDriver } from "./claude.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-claude-cli.ts");

describe("Claude turns with the MCP host", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "dusk-claude-host-"));
    const routes = createMcpHostRoutes(mcpHost);
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      void routes({ req, res, url, path: url.pathname, method: req.method ?? "GET", auth: {} as never, json, readBody })
        .then(() => { if (!res.headersSent) { res.statusCode = 404; res.end(); } });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
    mcpHost.listening(port);
    process.env.FAKE_CLAUDE_DUMP = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_MCP_STARTUP = "1";
    process.env.FAKE_CLAUDE_MCP_STARTUP_LOG = join(scratch, "startup.jsonl");
    instance = await ClaudeDriver.create({ instanceId: "claude-host", displayName: "Claude", environment: {}, enabled: true, config: { cli: FAKE_CLI, permissionMode: "acceptEdits" } });
    recorder = recordEvents(instance.adapter);
  });

  afterEach(async () => {
    await instance.adapter.stopAll?.();
    mcpHost.listening(null);
    delete process.env.FAKE_CLAUDE_DUMP;
    delete process.env.FAKE_CLAUDE_MCP_STARTUP;
    delete process.env.FAKE_CLAUDE_MCP_STARTUP_LOG;
    await new Promise((resolve) => server.close(resolve));
    rmSync(scratch, { recursive: true, force: true });
  });

  const dweb = { url: "http://127.0.0.1:9" };
  const own = { command: process.execPath, args: [join(dirname(FAKE_CLI), "fake-mcp-server.ts")], env: {} };
  const startup = () => readFileSync(process.env.FAKE_CLAUDE_MCP_STARTUP_LOG!, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { server: string; transport: string; ok: boolean; tools: string[] });

  it("mounts dusk bot's own servers over HTTP and keeps the person's on stdio", async () => {
    await instance.adapter.sendTurn({ threadId: "host-1", text: "hi", approvalMode: "ask", integrations: { dweb, custom: { notes: own } } as never });
    await recorder.until((event) => event.type === "turn.completed");
    const seen = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_DUMP!, "utf8"));
    expect(seen.mcpConfig.mcpServers.dweb).toMatchObject({ type: "http", url: `http://127.0.0.1:${port}/api/internal/mcp-host/dweb` });
    expect(seen.mcpConfig.mcpServers.dusk).toMatchObject({ type: "http", url: `http://127.0.0.1:${port}/api/internal/mcp-host/dusk`, alwaysLoad: true });
    expect(seen.mcpConfig.mcpServers.notes).toMatchObject({ command: process.execPath });
    expect(seen.argv[seen.argv.indexOf("--permission-prompt-tool") + 1]).toBe("mcp__dusk__approve");
    expect(seen.argv).toContain("--strict-mcp-config");
    const bearer = String(seen.mcpConfig.mcpServers.dusk.headers.Authorization);
    expect(JSON.stringify(seen.argv)).not.toContain(bearer.slice("Bearer ".length));
    const lines = startup();
    expect(lines.find((line) => line.server === "dusk")).toMatchObject({ transport: "http", ok: true, tools: ["approve", "ask_user"] });
    expect(lines.find((line) => line.server === "dweb")).toMatchObject({ transport: "http", ok: true });
    expect(lines.find((line) => line.server === "notes")).toMatchObject({ transport: "stdio" });
  });

  it("keeps a warm engine's bearers across turns and revokes them when it closes", async () => {
    await instance.adapter.sendTurn({ threadId: "host-2", text: "one", approvalMode: "ask", integrations: { dweb } as never });
    await recorder.until((event) => event.type === "turn.completed");
    const first = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_DUMP!, "utf8"));
    const before = mcpHost.registry.mounts().filter((mount) => mount.threadId === "host-2").length;
    // dweb, dusk, and the dusk a keep-warm fork gets, which reaches no broker.
    expect(before).toBe(3);
    recorder.events.length = 0;
    await instance.adapter.sendTurn({ threadId: "host-2", text: "two", approvalMode: "ask", integrations: { dweb } as never });
    await recorder.until((event) => event.type === "turn.completed");
    const second = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_DUMP!, "utf8"));
    expect(second.pid).toBe(first.pid);
    expect(mcpHost.registry.mounts().filter((mount) => mount.threadId === "host-2").length).toBe(before);
    const url = first.mcpConfig.mcpServers.dweb.url as string;
    const headers = first.mcpConfig.mcpServers.dweb.headers as Record<string, string>;
    const ping = () => fetch(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }).then((response) => response.status);
    expect(await ping()).toBe(200);
    await instance.adapter.stopAll?.();
    await expect.poll(() => mcpHost.registry.mounts().filter((mount) => mount.threadId === "host-2").length, { timeout: 15_000 }).toBe(0);
    expect(await ping()).toBe(401);
  });

  it("keeps stdio relays for a CLI it can't identify, and when the host is off", async () => {
    await instance.adapter.sendTurn({ threadId: "host-3", text: "hi", approvalMode: "ask", integrations: { dweb } as never });
    await recorder.until((event) => event.type === "turn.completed");
    expect(existsSync(process.env.FAKE_CLAUDE_DUMP!)).toBe(true);
    mcpHost.listening(null);
    recorder.events.length = 0;
    await instance.adapter.sendTurn({ threadId: "host-4", text: "hi", approvalMode: "ask", integrations: { dweb } as never });
    await recorder.until((event) => event.type === "turn.completed");
    const seen = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_DUMP!, "utf8"));
    expect(seen.mcpConfig.mcpServers.dweb).toMatchObject({ command: process.execPath, args: [SPAWNED_PROXIES.dweb] });
    expect(seen.mcpConfig.mcpServers.dusk.args[0]).toBe(SPAWNED_PROXIES.permission);
  });
});
