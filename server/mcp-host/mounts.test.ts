import { describe, expect, it } from "vitest";

import { MountLease, MountRegistry, TOKEN_PATTERN, mountFingerprint, type MountSpec } from "./mounts.ts";

const agents = (threadId: string, botId = "bot-a"): MountSpec => ({
  threadId, name: "agents",
  server: { kind: "agents", env: { DUSK_HARNESS_URL: "http://127.0.0.1:8799", DUSK_COMMS_TOKEN: `comms-${threadId}`, DUSK_BOT_ID: botId, DUSK_THREAD_ID: threadId } },
});
const data = (threadId: string): MountSpec => ({
  threadId, name: "data", server: { kind: "harness", family: "data", harnessUrl: "http://127.0.0.1:8799/", token: `data-${threadId}` },
});

describe("MCP host mounts", () => {
  it("gives a thread's server one bearer while it is held, and a new one after the last hold goes", () => {
    const registry = new MountRegistry();
    const first = registry.acquire(agents("t1"));
    const again = registry.acquire(agents("t1"));
    expect(again.token).toBe(first.token);
    expect(first.token).toMatch(TOKEN_PATTERN);
    expect(registry.resolve(first.token, "agents")).toBe(first.mount);
    registry.release(first.mount);
    expect(registry.resolve(first.token, "agents")).toBe(first.mount);
    registry.release(first.mount);
    expect(registry.resolve(first.token, "agents")).toBeNull();
    const later = registry.acquire(agents("t1"));
    expect(later.token).not.toBe(first.token);
    expect(registry.resolve(first.token, "agents")).toBeNull();
  });

  it("never lets one thread's bearer, or one server's, open another mount", () => {
    const registry = new MountRegistry();
    const mine = registry.acquire(agents("t1"));
    const theirs = registry.acquire(agents("t2", "bot-b"));
    const myData = registry.acquire(data("t1"));
    expect(new Set([mine.token, theirs.token, myData.token]).size).toBe(3);
    expect(registry.resolve(mine.token, "agents")?.threadId).toBe("t1");
    expect(registry.resolve(theirs.token, "agents")?.threadId).toBe("t2");
    expect(registry.resolve(myData.token, "agents")).toBeNull();
    expect(registry.resolve(mine.token, "data")).toBeNull();
    expect(registry.resolve(`${mine.token}x`, "agents")).toBeNull();
    expect(registry.resolve(mine.token.slice(0, -1), "agents")).toBeNull();
    expect(registry.resolve("", "agents")).toBeNull();
  });

  it("mints a new bearer when anything the mount carries changes", () => {
    const registry = new MountRegistry();
    const base = registry.acquire(data("t1"));
    const rotated = registry.acquire({ ...data("t1"), server: { kind: "harness", family: "data", harnessUrl: "http://127.0.0.1:8799/", token: "data-t1-next" } });
    const scoped = registry.acquire({ ...data("t1"), toolScope: { allow: ["mcp:data:data_describe"] } });
    expect(new Set([base.token, rotated.token, scoped.token]).size).toBe(3);
    expect(mountFingerprint(data("t1"))).toBe(mountFingerprint({ ...data("t1") }));
  });

  it("keeps no bearer it can be asked for: only a hash names a mount", () => {
    const registry = new MountRegistry();
    const { token, mount } = registry.acquire(agents("t1"));
    expect(JSON.stringify(mount)).not.toContain(token);
    expect(JSON.stringify(registry.mounts())).not.toContain(token);
  });

  it("refuses names a URL path could not carry", () => {
    const registry = new MountRegistry();
    for (const name of ["", "a/b", "..", "a b", "x".repeat(65)]) expect(() => registry.acquire({ ...agents("t1"), name })).toThrow();
    expect(() => registry.acquire({ ...agents("t1"), threadId: "" })).toThrow();
  });

  it("gives back a lease's holds once, closing the state of each mount it was the last to hold", () => {
    const registry = new MountRegistry();
    const closed: string[] = [];
    const lease = new MountLease(registry);
    const token = lease.acquire(agents("t1"));
    const other = new MountLease(registry);
    other.acquire(agents("t1"));
    registry.resolve(token, "agents")!.state = { close: () => closed.push("agents") };
    lease.release();
    lease.release();
    expect(registry.resolve(token, "agents")).not.toBeNull();
    other.release();
    expect(registry.resolve(token, "agents")).toBeNull();
    expect(closed).toEqual(["agents"]);
    expect(() => lease.acquire(agents("t1"))).toThrow();
  });

  it("revokes every mount of a thread, whoever holds it", () => {
    const registry = new MountRegistry();
    const lease = new MountLease(registry);
    const a = lease.acquire(agents("t1"));
    const d = lease.acquire(data("t1"));
    const b = registry.acquire(agents("t2")).token;
    registry.revokeThread("t1");
    expect(registry.resolve(a, "agents")).toBeNull();
    expect(registry.resolve(d, "data")).toBeNull();
    expect(registry.resolve(b, "agents")).not.toBeNull();
    lease.release();
    expect(registry.mounts()).toHaveLength(1);
  });
});
