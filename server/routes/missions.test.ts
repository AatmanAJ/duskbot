import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { VisibleSet } from "../bot-visibility.ts";
import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { requiredScope } from "../request-auth.ts";
import type { Assignment } from "../runtime/types.ts";
import { Store } from "../store.ts";
import { createMissionRoutes } from "./missions.ts";
import { dispatchRoutes } from "./table.ts";

const sonnet: ModelSelection = { instanceId: "claude", model: "claude-sonnet-5" };
const servers: Server[] = [];
beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve(store: Store, rows: Record<string, Assignment[]>, hidden: Set<string>): Promise<string> {
  const routes = [createMissionRoutes({
    store,
    coordinator: {
      job: (threadId) => ({ scopes: (rows[threadId] ?? []).map((row) => row.id), rows: rows[threadId] ?? [] }),
      events: () => [],
    },
    groupThreadIsWorking: () => false,
    viewerFor: () => ({ kind: "all" }),
    visibleTo: () => ({ bot: () => true, thread: (threadId: string) => !hidden.has(threadId) }) as unknown as VisibleSet,
    sessions: { isLive: () => true },
    now: () => 50_000,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const get = async (base: string, path: string) => {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, body: await response.json() as any };
};

const done = (id: string, botId: string, threadId: string, result: string): Assignment => ({
  id, rootId: id, depth: 0, origin: { kind: "person", source: "chat" }, requester: { kind: "person", threadId, botId },
  assignee: { botId, destination: { kind: "standing_thread", threadId } }, mode: "work", reply: "resume", brief: "Go",
  status: "completed", level: "full", levelSource: "own", executions: 1, restarts: 0, createdAt: 11_000, startedAt: 11_100,
  lastActivityAt: 12_000, finishedAt: 12_000, result, rework: false, version: 1,
});

describe("GET /api/missions", () => {
  it("is a client read", () => {
    expect(requiredScope("GET", "/api/missions")).toBe("client");
    expect(requiredScope("GET", "/api/missions/m-abcdef")).toBe("client");
    expect(requiredScope("POST", "/api/missions/m-abcdef")).toBe("admin");
  });

  it("groups tagged conversations into missions, newest first, and reads each lane's file changes since launch", async () => {
    const store = new Store(() => sonnet);
    const ada = store.createBot({ name: "Ada" });
    const ben = store.createBot({ name: "Ben" });
    const tag = (id: string, title: string, lane: number, launchedAt: number) => ({ mission: { id, title, lane, launchedAt, brief: "Map the rivals" } });
    const a = store.createTask(ada.id, "Rivals", false)!;
    store.patchTask(ada.id, a.threadId, tag("m-rivals", "Rivals", 0, 10_000));
    const b = store.createTask(ben.id, "Rivals", false)!;
    store.patchTask(ben.id, b.threadId, tag("m-rivals", "Rivals", 1, 10_000));
    const older = store.createTask(ben.id, "Copy", false)!;
    store.patchTask(ben.id, older.threadId, tag("m-copy", "Copy pass", 0, 1_000));
    store.createTask(ada.id, "Untagged", false);
    const digest = (at: number, added: string[]) => store.appendMessage(a.threadId, {
      role: "bot", kind: "digest", text: "[digest]",
      digest: { turnId: `t${at}`, botId: ada.id, threadId: a.threadId, at, durationMs: 1, tools: [], memory: [], reply: "", hookCoverage: "none",
        files: { added, changed: [], deleted: [] } },
    });
    digest(9_000, ["before-launch.md"]);
    digest(12_000, ["rivals.md"]);
    const hidden = new Set<string>();
    const base = await serve(store, { [a.threadId]: [done("ra", ada.id, a.threadId, "Three rivals.")] }, hidden);

    const listed = (await get(base, "/api/missions")).body.missions;
    expect(listed.map((one: any) => [one.id, one.lanes, one.state])).toEqual([["m-rivals", 2, "partly-done"], ["m-copy", 1, "idle"]]);
    expect(listed[0].counts).toMatchObject({ done: 1, idle: 1 });

    const view = (await get(base, "/api/missions/m-rivals")).body;
    expect(view.board.map((lane: any) => [lane.botName, lane.state])).toEqual([["Ada", "done"], ["Ben", "idle"]]);
    expect(view.board[0]).toMatchObject({ reply: "Three rivals.", files: [{ path: "rivals.md", change: "added" }], brief: "Map the rivals" });
    expect(view.board[1].reason).toBe("Its first message has not gone out");

    hidden.add(b.threadId);
    expect((await get(base, "/api/missions/m-rivals")).body.board.map((lane: any) => lane.botName)).toEqual(["Ada"]);
    hidden.add(a.threadId);
    expect((await get(base, "/api/missions/m-rivals")).status).toBe(404);
    expect((await get(base, "/api/missions")).body.missions.map((one: any) => one.id)).toEqual(["m-copy"]);
  });
});
