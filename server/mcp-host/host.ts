// The one MCP host in the harness: its mounts and how each answers. Engines that reach MCP servers by URL get dusk bot's
// own servers here instead of a relay process per server per warm engine (docs/mcp-host.md).
import { agentsMcp } from "../drivers/agents-mcp.ts";
import { TOOL_BRIDGE_ENV } from "../drivers/agents-bridge.ts";
import type { Json } from "../drivers/agents-client.ts";
import { dwebMcp } from "../drivers/dweb-mcp.ts";
import { phoneMcp } from "../drivers/phone-proxy.ts";
import { harnessMcpRequest } from "../harness-mcp-request.ts";
import { createPermissionMcp } from "../permission-mcp.ts";
import { parseToolLimit } from "../tool-count-limit.ts";
import { MountLease, MountRegistry, type HostedServer, type Mount, type MountSpec } from "./mounts.ts";
import { scopeGate, type Answer } from "./scope-gate.ts";

export const MCP_HOST_PATH = "/api/internal/mcp-host/";
/** "0" keeps every engine on its stdio relays. */
export const MCP_HOST_ENV = "DUSK_MCP_HOST";

/** Who an agents mount speaks for, as its relay's environment said: not secret, and checked against the mount on every
 * request, so a disagreeing claim is refused as the internal routes refuse one. */
export const MOUNT_BOT_HEADER = "x-dusk-bot-id";
export const MOUNT_THREAD_HEADER = "x-dusk-thread-id";

/** The identity headers a request on `mount` may carry: any it sends must match. */
export function mountIdentity(mount: Pick<Mount, "server">): Record<string, string> {
  if (mount.server.kind !== "agents") return {};
  const { DUSK_BOT_ID: bot, DUSK_THREAD_ID: thread } = mount.server.env;
  return { ...(bot ? { [MOUNT_BOT_HEADER]: bot } : {}), ...(thread ? { [MOUNT_THREAD_HEADER]: thread } : {}) };
}

export interface HttpMount {
  type: "http";
  url: string;
  headers: Record<string, string>;
}

function serverAnswer(server: HostedServer, scoped: boolean, stop: AbortSignal): { answer: Answer; close?: () => void } {
  switch (server.kind) {
    case "agents": {
      // Security: behind a selection the agents server is never bridged: the selection judges the name in the call.
      const env: NodeJS.ProcessEnv = { ...server.env };
      if (scoped) delete env[TOOL_BRIDGE_ENV];
      const answer = agentsMcp(env, stop);
      return { answer: (frame) => answer(frame as Json) };
    }
    case "harness": {
      const toolLimit = parseToolLimit(server.toolLimit);
      return { answer: (frame, signal) => harnessMcpRequest(frame, { url: server.harnessUrl, token: server.token, kind: server.family, toolLimit,
        stop: signal ? AbortSignal.any([signal, stop]) : stop }) };
    }
    case "permission": {
      const permission = createPermissionMcp({ socketPath: server.socketPath, toolScope: server.toolScope });
      return { answer: (frame) => permission.answer(frame), close: () => permission.close() };
    }
    case "dweb": {
      const answer = dwebMcp(server.url);
      return { answer: (frame) => answer(frame) };
    }
    case "phone": {
      const answer = phoneMcp({ ...process.env, ...server.env });
      return { answer: (frame) => answer(frame) };
    }
  }
}

/** The version the client asked for: these servers answer alike in every version. */
function echoProtocolVersion(frame: Record<string, unknown>, reply: unknown): unknown {
  const asked = (frame.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  const result = (reply as { result?: { protocolVersion?: unknown } } | undefined)?.result;
  if (frame.method === "initialize" && typeof asked === "string" && result && typeof result === "object") return { ...(reply as object), result: { ...result, protocolVersion: asked } };
  return reply;
}

export class McpHost {
  readonly registry = new MountRegistry();
  /** How often a streamed tool call's answer carries a keep-alive comment while it runs. */
  keepAliveMs = 15_000;
  /** How long a tool call may take before its answer switches to an event stream. */
  streamAfterMs = 2_000;
  private origin: string | null = null;
  private readonly answers = new WeakMap<Mount, Answer>();

  /** The harness's own loopback listener, once it is up. Until then (and in a driver's unit tests) engines keep relays. */
  listening(port: number | null): void {
    this.origin = port === null ? null : `http://127.0.0.1:${port}`;
  }

  enabled(env: Record<string, string | undefined> = process.env): boolean {
    return this.origin !== null && env[MCP_HOST_ENV] !== "0";
  }

  lease(): MountLease {
    return new MountLease(this.registry);
  }

  /** The engine's entry for one mount: its URL and bearer. */
  entry(lease: MountLease, spec: MountSpec): HttpMount {
    if (!this.origin) throw new Error("The MCP host is not listening.");
    const token = lease.acquire(spec);
    return { type: "http", url: `${this.origin}${MCP_HOST_PATH}${spec.name}`, headers: { Authorization: `Bearer ${token}`, ...mountIdentity(spec) } };
  }

  /** Drops the state of a thread's mounts of `name`, so their next request starts afresh: a new broker was bound for
   * the thread, and a connection to the old one would only ever hear that its turn had ended. */
  restart(threadId: string, name: string): void {
    for (const mount of this.registry.mounts()) {
      if (mount.threadId !== threadId || mount.name !== name) continue;
      const state = mount.state;
      mount.state = undefined;
      this.answers.delete(mount);
      try { state?.close?.(); } catch {}
    }
  }

  answer(mount: Mount): Answer {
    const known = this.answers.get(mount);
    if (known) return known;
    const stop = new AbortController();
    const built = serverAnswer(mount.server, mount.toolScope !== undefined, stop.signal);
    const inner = mount.toolScope !== undefined ? scopeGate(mount.name, mount.toolScope, built.answer) : built.answer;
    const answer: Answer = async (frame, signal) => echoProtocolVersion(frame, await inner(frame, signal));
    const previous = mount.state?.close;
    mount.state = { close: () => { stop.abort(); built.close?.(); previous?.(); } };
    this.answers.set(mount, answer);
    return answer;
  }
}

export const mcpHost = new McpHost();
