// Which of a turn's stdio MCP servers are dusk bot's own relays, and the hosted server each stands for. A relay is known
// by the script it runs (proxy-paths.ts) and carries everything the host needs in its environment; any other server,
// the person's own or a third party's, stays a stdio server of the engine's.
import { parseToolScope, type ToolScope } from "../../shared/tool-scope.ts";
import { parseHarnessMcpKind } from "../harness-mcp-request.ts";
import { harnessMcpTokenEnv } from "../harness-mcp-token.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { TOOL_LIMIT_ENV } from "../tool-count-limit.ts";
import type { HostedServer } from "./mounts.ts";

interface StdioSpec {
  command?: unknown;
  args?: unknown;
  env?: unknown;
}

/** Only what the relay's own process is told, never the engine's: these name how a child runs, not what it may do. */
const PROCESS_ONLY = new Set(["ELECTRON_RUN_AS_NODE"]);

const LOOPBACK_HARNESS = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

function stringEnv(env: unknown): Record<string, string> | null {
  if (env === undefined) return {};
  if (!env || typeof env !== "object" || Array.isArray(env)) return null;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string") return null;
    if (!PROCESS_ONLY.has(name)) out[name] = value;
  }
  return out;
}

function permissionScope(raw: string | undefined): ToolScope | undefined | null {
  if (raw === undefined) return undefined;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  const parsed = parseToolScope(value);
  return parsed.ok ? parsed.scope : null;
}

/** The hosted server a relay spec stands for, or null when it is not one of dusk bot's relays or its settings are not
 * all there (that server then keeps its relay). */
export function hostedRelay(spec: unknown): HostedServer | null {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return null;
  const { command, args, env: rawEnv } = spec as StdioSpec;
  if (typeof command !== "string" || !Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return null;
  const env = stringEnv(rawEnv);
  if (!env) return null;
  const [script, ...rest] = args as string[];
  if (script === SPAWNED_PROXIES.agents && rest.length === 0) {
    if (!env.DUSK_COMMS_TOKEN || !env.DUSK_HARNESS_URL || !LOOPBACK_HARNESS.test(env.DUSK_HARNESS_URL)) return null;
    return { kind: "agents", env };
  }
  if (script === SPAWNED_PROXIES.harnessMcp && rest.length === 1) {
    const family = parseHarnessMcpKind(rest[0]);
    const token = family ? env[harnessMcpTokenEnv(family)] : undefined;
    if (!family || !token || !env.DUSK_HARNESS_URL || !LOOPBACK_HARNESS.test(env.DUSK_HARNESS_URL)) return null;
    return { kind: "harness", family, harnessUrl: `${env.DUSK_HARNESS_URL}/`, token, ...(env[TOOL_LIMIT_ENV] !== undefined ? { toolLimit: env[TOOL_LIMIT_ENV] } : {}) };
  }
  if (script === SPAWNED_PROXIES.permission && rest.length === 1) {
    const toolScope = permissionScope(env.DUSK_PERMISSION_TOOL_SCOPE);
    if (toolScope === null || !rest[0]) return null;
    return { kind: "permission", socketPath: rest[0], ...(toolScope ? { toolScope } : {}) };
  }
  if (script === SPAWNED_PROXIES.dweb && rest.length === 0) {
    return env.DWEB_URL ? { kind: "dweb", url: env.DWEB_URL } : null;
  }
  if (script === SPAWNED_PROXIES.phone && rest.length === 0) {
    return { kind: "phone", env };
  }
  return null;
}
