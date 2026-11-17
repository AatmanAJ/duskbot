// A turn's MCP config with dusk bot's own relays swapped for mounts of the harness's MCP host: one HTTP entry each,
// where each was a Node process (and, behind a tool selection, a gate process too) in every warm engine. The person's
// own servers and third parties' stay as they are. Shared by every engine that reaches MCP servers by URL.
import { parseToolScope, type ToolScope } from "../../shared/tool-scope.ts";
import { mcpHost, type HttpMount, type McpHost } from "../mcp-host/host.ts";
import type { MountLease } from "../mcp-host/mounts.ts";
import { hostedRelay } from "../mcp-host/relays.ts";
import { SPAWNED_PROXIES } from "../proxy-paths.ts";

/** A gate's settings that change nothing but which tools run: the host enforces a selection itself. Anything else a
 * gate does (trims results, fits schemas, observes an app, lists a directory) keeps the gate. */
const SCOPE_ONLY_GATE = new Set(["DUSK_GATE_NAME", "DUSK_GATE_UPSTREAM", "DUSK_GATE_SPILL_DIR", "DUSK_GATE_BUDGET", "DUSK_GATE_TOOL_SCOPE"]);

/** The relay a selection-only gate wraps and the selection it enforces, or null. */
function scopeGated(spec: unknown, name: string): { upstream: unknown; toolScope: ToolScope } | null {
  const { args, env } = (spec ?? {}) as { args?: unknown; env?: Record<string, unknown> };
  if (!Array.isArray(args) || args.length !== 1 || args[0] !== SPAWNED_PROXIES.mcpGate || !env || typeof env !== "object") return null;
  const settings = Object.keys(env).filter((key) => key !== "ELECTRON_RUN_AS_NODE");
  if (!settings.every((key) => SCOPE_ONLY_GATE.has(key)) || env.DUSK_GATE_NAME !== name || env.DUSK_GATE_BUDGET !== "0") return null;
  if (typeof env.DUSK_GATE_UPSTREAM !== "string" || typeof env.DUSK_GATE_TOOL_SCOPE !== "string") return null;
  try {
    const parsed = parseToolScope(JSON.parse(env.DUSK_GATE_TOOL_SCOPE));
    if (!parsed.ok || parsed.scope === undefined) return null;
    return { upstream: JSON.parse(env.DUSK_GATE_UPSTREAM), toolScope: parsed.scope };
  } catch {
    return null;
  }
}

export interface HostedMcpServers {
  servers: Record<string, unknown>;
  /** The names now answered by the host. */
  hosted: string[];
}

/** `servers` with every hostable entry mounted for `threadId` under `lease`. The same settings get the same bearer while
 * the lease's mounts are held. */
export function hostMcpServers(input: {
  servers: Readonly<Record<string, unknown>>;
  threadId: string;
  lease: MountLease;
  host?: McpHost;
  /** Engine-side keys of an entry to keep on its HTTP mount (Claude's alwaysLoad). */
  keep?: readonly string[];
  /** `false` keeps a selection-gated server behind its gate. */
  gated?: boolean;
}): HostedMcpServers {
  const host = input.host ?? mcpHost;
  const servers: Record<string, unknown> = {};
  const hosted: string[] = [];
  for (const [name, spec] of Object.entries(input.servers)) {
    const gate = input.gated === false ? null : scopeGated(spec, name);
    const server = hostedRelay(gate ? gate.upstream : spec);
    if (!server) {
      servers[name] = spec;
      continue;
    }
    const mount: HttpMount = host.entry(input.lease, { threadId: input.threadId, name, server, ...(gate ? { toolScope: gate.toolScope } : {}) });
    const kept = Object.fromEntries((input.keep ?? []).flatMap((key) => {
      const value = (spec as Record<string, unknown>)[key];
      return value === undefined ? [] : [[key, value]];
    }));
    servers[name] = { ...mount, ...kept };
    hosted.push(name);
  }
  return { servers, hosted };
}
