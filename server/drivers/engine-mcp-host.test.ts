import { describe, expect, it } from "vitest";

import { gateServer } from "../mcp-gate-config.ts";
import { McpHost } from "../mcp-host/host.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { hostMcpServers } from "./engine-mcp-host.ts";

const node = process.execPath;
const HARNESS = "http://127.0.0.1:8799";
const agents = { command: node, args: [SPAWNED_PROXIES.agents], env: { ELECTRON_RUN_AS_NODE: "1", DUSK_HARNESS_URL: HARNESS, DUSK_COMMS_TOKEN: "comms-secret-1234567890", DUSK_BOT_ID: "b1" } };
const data = { command: node, args: [SPAWNED_PROXIES.harnessMcp, "data"], env: { DUSK_HARNESS_URL: HARNESS, DUSK_MCP_TOKEN_DATA: "data-secret-1234567890" } };
const own = { command: "npx", args: ["-y", "some-server"], env: { API_KEY: "the person's" } };

function host(): McpHost {
  const made = new McpHost();
  made.listening(8799);
  return made;
}

describe("hosting a turn's MCP servers", () => {
  it("mounts dusk bot's relays, keeps the engine's own keys and leaves the person's servers alone", () => {
    const mcp = host();
    const lease = mcp.lease();
    const { servers, hosted } = hostMcpServers({ servers: { agents: { ...agents, alwaysLoad: true }, data, notes: own }, threadId: "t1", lease, host: mcp, keep: ["alwaysLoad"] });
    expect(hosted).toEqual(["agents", "data"]);
    expect(servers.notes).toBe(own);
    expect(servers.agents).toMatchObject({ type: "http", url: "http://127.0.0.1:8799/api/internal/mcp-host/agents", alwaysLoad: true });
    expect(servers.data).toMatchObject({ type: "http", url: "http://127.0.0.1:8799/api/internal/mcp-host/data" });
    // The engine is handed only the mount's bearer, never the turn capability behind it.
    const engine = JSON.stringify(servers);
    expect(engine).not.toContain("comms-secret-1234567890");
    expect(engine).not.toContain("data-secret-1234567890");
    expect(lease.size).toBe(2);
  });

  it("gives the same launch the same bearers while it is held, so a warm engine stays reusable", () => {
    const mcp = host();
    const first = mcp.lease();
    const again = mcp.lease();
    const a = hostMcpServers({ servers: { agents, data }, threadId: "t1", lease: first, host: mcp }).servers;
    const b = hostMcpServers({ servers: { agents, data }, threadId: "t1", lease: again, host: mcp }).servers;
    expect(b).toEqual(a);
    const other = hostMcpServers({ servers: { agents, data }, threadId: "t2", lease: mcp.lease(), host: mcp }).servers;
    expect(JSON.stringify(other)).not.toEqual(JSON.stringify(a));
  });

  it("takes a selection-only gate's place, enforcing its selection, and keeps any gate that does more", () => {
    const mcp = host();
    const scope = { allow: ["mcp:agents:list_bots", "mcp:data:*"] };
    const gatedAgents = gateServer({ name: "agents", server: agents, threadId: "t1", budget: 0, toolScope: scope, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } })!;
    const trimmingData = gateServer({ name: "data", server: data, threadId: "t1", budget: 4000, toolScope: scope, nodeEnv: { ELECTRON_RUN_AS_NODE: "1" } })!;
    const lease = mcp.lease();
    const { servers, hosted } = hostMcpServers({ servers: { agents: gatedAgents, data: trimmingData }, threadId: "t1", lease, host: mcp });
    expect(hosted).toEqual(["agents"]);
    expect(servers.data).toBe(trimmingData);
    expect(mcp.registry.mounts()[0]).toMatchObject({ name: "agents", toolScope: scope });
    const kept = hostMcpServers({ servers: { agents: gatedAgents }, threadId: "t1", lease: mcp.lease(), host: mcp, gated: false });
    expect(kept.hosted).toEqual([]);
  });

  it("refuses to mount before the harness is listening", () => {
    const mcp = new McpHost();
    expect(mcp.enabled({})).toBe(false);
    mcp.listening(8799);
    expect(mcp.enabled({})).toBe(true);
    expect(mcp.enabled({ DUSK_MCP_HOST: "0" })).toBe(false);
    expect(() => new McpHost().entry(mcp.lease(), { threadId: "t", name: "agents", server: { kind: "dweb", url: "x" } })).toThrow();
  });
});
