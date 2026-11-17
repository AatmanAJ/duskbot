// Mounts of dusk bot's own MCP servers answered inside the harness, one per thread, server and settings. An engine
// reaches a mount with its bearer, which names exactly that thread's server: the turn capability behind it (the comms
// token, a harness tool token) stays in this process and never reaches the engine.
import { createHash, randomBytes } from "node:crypto";

import type { ToolScope } from "../../shared/tool-scope.ts";
import type { HarnessMcpKind } from "../harness-mcp-request.ts";

/** What a mount answers with: the settings its stdio relay would be started with. */
export type HostedServer =
  | { kind: "agents"; env: Record<string, string> }
  | { kind: "harness"; family: HarnessMcpKind; harnessUrl: string; token: string; toolLimit?: string }
  | { kind: "permission"; socketPath: string | null; toolScope?: ToolScope }
  | { kind: "dweb"; url: string }
  | { kind: "phone"; env: Record<string, string> };

export interface MountSpec {
  threadId: string;
  /** The server's name in the engine's MCP config, and the last segment of its path. */
  name: string;
  server: HostedServer;
  /** The bot's tool selection, enforced here as a relay's gate would. */
  toolScope?: ToolScope;
}

export interface Mount extends Readonly<MountSpec> {
  readonly fingerprint: string;
  readonly tokenHash: string;
  refs: number;
  lastUsed: number;
  /** State a mount's server keeps between requests: an agents handler, a broker connection. */
  state?: { close?: () => void };
}

export const MOUNT_NAME = /^[A-Za-z0-9_-]{1,64}$/;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function mountFingerprint(spec: MountSpec): string {
  return sha256(JSON.stringify(canonical({ threadId: spec.threadId, name: spec.name, server: spec.server, toolScope: spec.toolScope ?? null })));
}

export class MountRegistry {
  private readonly byTokenHash = new Map<string, Mount>();
  private readonly byFingerprint = new Map<string, { mount: Mount; token: string }>();

  /** One more hold on the mount for `spec`. While any hold lasts, the same thread, server and settings get the same
   * bearer, so a warm engine's launch contract stays equal from one turn to the next. */
  acquire(spec: MountSpec): { token: string; mount: Mount } {
    if (!MOUNT_NAME.test(spec.name) || !spec.threadId) throw new Error("Invalid MCP host mount.");
    const fingerprint = mountFingerprint(spec);
    const held = this.byFingerprint.get(fingerprint);
    if (held) {
      held.mount.refs += 1;
      return held;
    }
    const token = randomBytes(32).toString("base64url");
    const mount: Mount = { threadId: spec.threadId, name: spec.name, server: spec.server, ...(spec.toolScope ? { toolScope: spec.toolScope } : {}),
      fingerprint, tokenHash: sha256(token), refs: 1, lastUsed: Date.now() };
    this.byTokenHash.set(mount.tokenHash, mount);
    this.byFingerprint.set(fingerprint, { mount, token });
    return { token, mount };
  }

  /** Drops one hold; the last one revokes the bearer and closes the mount's state. */
  release(mount: Mount): void {
    if (this.byTokenHash.get(mount.tokenHash) !== mount) return;
    mount.refs -= 1;
    if (mount.refs > 0) return;
    this.revoke(mount);
  }

  /** The mount a bearer names, and only on its own server's path: a thread's data bearer never opens its agents tools. */
  resolve(token: string, name: string): Mount | null {
    if (!TOKEN_PATTERN.test(token)) return null;
    const mount = this.byTokenHash.get(sha256(token));
    if (!mount || mount.name !== name) return null;
    mount.lastUsed = Date.now();
    return mount;
  }

  /** Every mount of a thread, whoever holds it: the thread is gone. */
  revokeThread(threadId: string): void {
    for (const mount of this.byTokenHash.values()) if (mount.threadId === threadId) this.revoke(mount);
  }

  mounts(): readonly Mount[] {
    return [...this.byTokenHash.values()];
  }

  private revoke(mount: Mount): void {
    this.byTokenHash.delete(mount.tokenHash);
    this.byFingerprint.delete(mount.fingerprint);
    const state = mount.state;
    mount.state = undefined;
    mount.refs = 0;
    try { state?.close?.(); } catch {}
  }
}

/** The holds one engine launch takes on its mounts, given back together when that engine goes. */
export class MountLease {
  private readonly held: Mount[] = [];
  private readonly registry: MountRegistry;
  private released = false;

  constructor(registry: MountRegistry) {
    this.registry = registry;
  }

  acquire(spec: MountSpec): string {
    if (this.released) throw new Error("This MCP host lease was already released.");
    const { token, mount } = this.registry.acquire(spec);
    this.held.push(mount);
    return token;
  }

  get size(): number {
    return this.held.length;
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    for (const mount of this.held.splice(0)) this.registry.release(mount);
  }
}
