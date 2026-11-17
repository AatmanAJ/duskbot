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

/** `servers` with every hostable entry of `own` mounted for `threadId` under `lease`. The same settings get the same
 * bearer while the lease's mounts are held. */
export function hostMcpServers(input: {
  servers: Readonly<Record<string, unknown>>;
  /** Security: only the servers the harness itself built for this turn. A bot's or the person's own server that names a
   * relay script would otherwise run in the harness, outside the bot box, with settings the bot chose. */
  own: ReadonlySet<string>;
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
    const server = input.own.has(name) ? hostedRelay(gate ? gate.upstream : spec) : null;
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

/** Claude's turn: `servers` (its --mcp-config, changed in place) with dusk bot's own relays on the host; `duskServer` for a
 * broker that bound another socket than planned; `pingDusk` for a keep-warm fork, listing the same tools and reaching no
 * broker. Without `enabled` every server keeps its relay. */
export function hostClaudeMcpServers(input: {
  servers: Record<string, unknown>;
  /** The bot's own and its project's servers: never hosted. */
  botOwned: ReadonlySet<string>;
  threadId: string;
  duskRelay: (socketPath: string) => Record<string, unknown>;
  socketPath: string;
  enabled: boolean;
  host?: McpHost;
}): { lease: MountLease | null; hosted: ReadonlySet<string>; duskServer: (socketPath: string) => unknown; pingDusk?: unknown } {
  const host = input.host ?? mcpHost;
  const hosted = new Set<string>();
  if (!input.enabled) return { lease: null, hosted, duskServer: input.duskRelay };
  const lease = host.lease();
  const own = new Set(Object.keys(input.servers).filter((name) => !input.botOwned.has(name)));
  const result = hostMcpServers({ servers: input.servers, own, threadId: input.threadId, lease, host, keep: ["alwaysLoad"] });
  for (const name of Object.keys(input.servers)) delete input.servers[name];
  Object.assign(input.servers, result.servers);
  for (const name of result.hosted) hosted.add(name);
  if (!hosted.has("dusk")) return { lease, hosted, duskServer: input.duskRelay };
  const duskServer = (socketPath: string) =>
    hostMcpServers({ servers: { dusk: input.duskRelay(socketPath) }, own: new Set(["dusk"]), threadId: input.threadId, lease, host, keep: ["alwaysLoad"] }).servers.dusk;
  const relay = hostedRelay(input.duskRelay(input.socketPath));
  const pingDusk = relay?.kind === "permission"
    ? { ...host.entry(lease, { threadId: input.threadId, name: "dusk", server: { ...relay, socketPath: null } }), alwaysLoad: true } : undefined;
  return { lease, hosted, duskServer, ...(pingDusk ? { pingDusk } : {}) };
}
