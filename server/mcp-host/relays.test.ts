import { describe, expect, it } from "vitest";

import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { hostedRelay } from "./relays.ts";

const node = process.execPath;
const HARNESS = "http://127.0.0.1:8799";

describe("which relays the MCP host stands in for", () => {
  it("knows each of dusk bot's own relays by its script, with the settings it was given", () => {
    expect(hostedRelay({ command: node, args: [SPAWNED_PROXIES.agents], env: { ELECTRON_RUN_AS_NODE: "1", DUSK_HARNESS_URL: HARNESS, DUSK_COMMS_TOKEN: "c", DUSK_BOT_ID: "b" } }))
      .toEqual({ kind: "agents", env: { DUSK_HARNESS_URL: HARNESS, DUSK_COMMS_TOKEN: "c", DUSK_BOT_ID: "b" } });
    expect(hostedRelay({ command: node, args: [SPAWNED_PROXIES.harnessMcp, "data"], env: { DUSK_HARNESS_URL: HARNESS, DUSK_MCP_TOKEN_DATA: "d", DUSK_TOOL_LIMIT: "12" } }))
      .toEqual({ kind: "harness", family: "data", harnessUrl: `${HARNESS}/`, token: "d", toolLimit: "12" });
    expect(hostedRelay({ command: node, args: [SPAWNED_PROXIES.permission, "/tmp/perm.sock"], env: { DUSK_PERMISSION_TOOL_SCOPE: JSON.stringify({ allow: ["mcp:dusk:approve"] }) } }))
      .toEqual({ kind: "permission", socketPath: "/tmp/perm.sock", toolScope: { allow: ["mcp:dusk:approve"] } });
    expect(hostedRelay({ command: node, args: [SPAWNED_PROXIES.permission, "\\\\.\\pipe\\duskbot-perm-1-t"] }))
      .toEqual({ kind: "permission", socketPath: "\\\\.\\pipe\\duskbot-perm-1-t" });
    expect(hostedRelay({ command: node, args: [SPAWNED_PROXIES.dweb], env: { DWEB_URL: "http://127.0.0.1:49737" } })).toEqual({ kind: "dweb", url: "http://127.0.0.1:49737" });
    expect(hostedRelay({ command: node, args: [SPAWNED_PROXIES.phone], env: { DUSK_PHONE_TOKEN: "p", DUSK_HARNESS_URL: HARNESS } }))
      .toEqual({ kind: "phone", env: { DUSK_PHONE_TOKEN: "p", DUSK_HARNESS_URL: HARNESS } });
  });

  it("leaves every other server, and any relay missing what it needs, to the engine", () => {
    for (const spec of [
      { command: "npx", args: ["-y", "@modelcontextprotocol/server-everything"] },
      { command: node, args: [SPAWNED_PROXIES.mcpGate], env: {} },
      { command: node, args: [SPAWNED_PROXIES.connectors], env: { DUSK_CONNECTOR_TOKEN: "x" } },
      { command: node, args: [SPAWNED_PROXIES.agents], env: { DUSK_HARNESS_URL: HARNESS } },
      { command: node, args: [SPAWNED_PROXIES.agents], env: { DUSK_HARNESS_URL: "http://10.0.0.2:8799", DUSK_COMMS_TOKEN: "c" } },
      { command: node, args: [SPAWNED_PROXIES.agents], env: { DUSK_HARNESS_URL: "https://127.0.0.1:8799", DUSK_COMMS_TOKEN: "c" } },
      { command: node, args: [SPAWNED_PROXIES.agents, "--extra"], env: { DUSK_HARNESS_URL: HARNESS, DUSK_COMMS_TOKEN: "c" } },
      { command: node, args: [SPAWNED_PROXIES.harnessMcp, "data"], env: { DUSK_HARNESS_URL: HARNESS } },
      { command: node, args: [SPAWNED_PROXIES.harnessMcp, "data"], env: { DUSK_HARNESS_URL: HARNESS, DUSK_MCP_TOKEN_DATA: "d", DUSK_SOMETHING_NEW: "1" } },
      { command: node, args: [SPAWNED_PROXIES.dweb], env: { DWEB_URL: "http://127.0.0.1:49737", DWEB_TOKEN: "x" } },
      { command: node, args: [SPAWNED_PROXIES.harnessMcp, "nope"], env: { DUSK_HARNESS_URL: HARNESS, DUSK_MCP_TOKEN_NOPE: "x" } },
      { command: node, args: [SPAWNED_PROXIES.permission], env: {} },
      { command: node, args: [SPAWNED_PROXIES.permission, "/s"], env: { DUSK_PERMISSION_TOOL_SCOPE: "{not json" } },
      { command: node, args: [SPAWNED_PROXIES.dweb], env: {} },
      { command: node, args: [SPAWNED_PROXIES.agents], env: { DUSK_HARNESS_URL: HARNESS, DUSK_COMMS_TOKEN: 7 } },
      { type: "http", url: "https://example.com/mcp" },
      null, "agents", [],
    ]) expect(hostedRelay(spec)).toBeNull();
  });
});
