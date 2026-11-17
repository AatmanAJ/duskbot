// An ACP agent that reaches servers by URL (opencode) gets dusk bot's own as mounts of the harness's MCP host: the
// mount's bearer, never the turn capability behind it, and the same bearer while the thread's lease holds.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mcpHost } from "../mcp-host/host.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { acpMcpServers } from "./turn-mcp.ts";

const HARNESS = "http://127.0.0.1:8799";
const turn = {
  threadId: "acp-1", text: "hi",
  integrations: {
    agents: { command: process.execPath, args: [SPAWNED_PROXIES.agents], env: { DUSK_HARNESS_URL: HARNESS, DUSK_COMMS_TOKEN: "comms-capability-0123456789", DUSK_BOT_ID: "b1", DUSK_THREAD_ID: "acp-1" } },
    data: { command: process.execPath, args: [SPAWNED_PROXIES.harnessMcp, "data"], env: { DUSK_HARNESS_URL: HARNESS, DUSK_MCP_TOKEN_DATA: "data-capability-0123456789" } },
    custom: { notes: { command: "npx", args: ["notes-server"], env: { NOTES_KEY: "the person's" } } },
  },
} as never;

describe("ACP agents and the MCP host", () => {
  beforeEach(() => mcpHost.listening(8799));
  afterEach(() => mcpHost.listening(null));

  it("hands an HTTP agent mounts and leaves the person's servers on stdio", () => {
    const lease = mcpHost.lease();
    const servers = acpMcpServers(turn, { http: true, lease });
    const byName = Object.fromEntries(servers.map((server) => [server.name, server]));
    expect(byName.agents).toMatchObject({ type: "http", url: `${HARNESS}/api/internal/mcp-host/agents` });
    expect(byName.data).toMatchObject({ type: "http", url: `${HARNESS}/api/internal/mcp-host/data` });
    expect(byName.notes).toMatchObject({ command: "npx" });
    const handed = JSON.stringify(servers);
    expect(handed).not.toContain("comms-capability-0123456789");
    expect(handed).not.toContain("data-capability-0123456789");
    const again = acpMcpServers(turn, { http: true, lease: mcpHost.lease() });
    expect(JSON.stringify(again)).toBe(handed);
    lease.release();
  });

  it("keeps a stdio agent on its relays", () => {
    const servers = acpMcpServers(turn, { http: false, lease: mcpHost.lease() });
    expect(servers.every((server) => "command" in server)).toBe(true);
  });
});
