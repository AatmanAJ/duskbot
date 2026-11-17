import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openMcp, type McpEntry } from "./testing/fake-mcp-client.ts";
import { freePortBlock } from "./testing/ports.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let child: ChildProcess;
let fixtureHome = "";
let base = "";
let dumpFile = "";
let finishFile = "";
let stderr = "";
const PHONE_BUSY_ERROR = "another thread is using the phone";
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await r.json() as any;
  expect(r.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
  return result;
};
async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const end = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() >= end) throw new Error(`Fixture wait expired: ${JSON.stringify(value)}\n${stderr}`);
    await new Promise(r => setTimeout(r, 40));
  }
}
// The fake CLI writes its dump in one go; a poll can land mid-write, so a partial file is "not yet".
const dump = () => until(() => {
  if (!existsSync(dumpFile)) return null;
  try { return JSON.parse(readFileSync(dumpFile, "utf8")); } catch { return null; }
}, Boolean);
const idle = (botId: string) => until(() => api("GET", "/api/bots?messages=0"), s => !s.bots.find((b: any) => b.id === botId)?.busy);
const busy = (botId: string) => until(() => api("GET", "/api/bots?messages=0"), s => s.bots.find((b: any) => b.id === botId)?.busy === true);
const phoneSpec = (d: any) => {
  expect(d.mcpConfig?.mcpServers?.phone, "phone tools should be mounted").toBeTruthy();
  return d.mcpConfig.mcpServers.phone;
};
const holdDirectTurn = async (botId: string, text: string) => {
  rmSync(dumpFile, { force: true });
  await api("POST", `/api/bots/${botId}/messages`, { text });
  return phoneSpec(await dump());
};
const holdRoomTurn = async (groupId: string, text: string) => {
  rmSync(dumpFile, { force: true });
  await api("POST", `/api/groups/${groupId}/messages`, { text });
  return phoneSpec(await dump());
};
const noPhoneConflict = async (...botIds: string[]) => {
  const state = await api("GET", "/api/bots?messages=50");
  for (const botId of botIds) {
    const bot = state.bots.find((b: any) => b.id === botId);
    expect(JSON.stringify(bot?.messages ?? [])).not.toContain(PHONE_BUSY_ERROR);
  }
};

// One connection to a turn's phone mount on the harness's MCP host, as its engine reaches it: initialize, then tools/call.
async function withPhoneMount<T>(spec: McpEntry, run: (call: (name: string) => Promise<any>) => Promise<T>): Promise<T> {
  const connection = openMcp(spec);
  try {
    await connection.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "phone-claim-test", version: "1" } });
    await connection.notify("notifications/initialized");
    return await run((name: string) => connection.call("tools/call", { name, arguments: {} }));
  } finally {
    await connection.close();
  }
}

beforeAll(async () => {
  fixtureHome = mkdtempSync(join(tmpdir(), "dusk-phone-claim-"));
  writeFileSync(join(fixtureHome, "devices"), 'process.stdout.write("List of devices attached\\n");');
  dumpFile = join(fixtureHome, "dump.json");
  finishFile = join(fixtureHome, "finish");
  const data = join(fixtureHome, "data");
  const ui = join(fixtureHome, "static");
  mkdirSync(data); mkdirSync(join(ui, "assets"), { recursive: true });
  writeFileSync(join(ui, "index.html"), "<title>Phone claim</title>");
  writeFileSync(join(ui, "assets", "test.css"), "body{}");
  writeFileSync(join(data, "config.json"), JSON.stringify({ instances: { claude: {
    driver: "claudeAgent", config: { cli: join(ROOT, "server/testing/fake-claude-cli.ts") },
    environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_DUMP: dumpFile, FAKE_CLAUDE_SLOW_FINISH_GATE: finishFile },
  } } }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  // Node is an inert cross-platform adb, run in the fixture's home where `devices` answers: the phone server, answered
  // inside the harness, never discovers or contacts a real attached phone.
  child = spawn(process.execPath, [join(ROOT, "server/index.ts")], {
    cwd: fixtureHome, env: {
      PATH: process.env.PATH, HOME: fixtureHome, USERPROFILE: fixtureHome, DUSK_DATA_DIR: data, DUSK_ADB_PATH: process.execPath,
      DUSK_SKILLS_DIR: join(ROOT, "skills"),
      APPDATA: join(fixtureHome, "appdata"), LOCALAPPDATA: join(fixtureHome, "localappdata"),
      TEMP: fixtureHome, TMP: fixtureHome, TMPDIR: fixtureHome,
      DUSK_PORT: String(port), DUSK_WEBHOOK_PORT: String(port + 1), DUSK_STATIC_DIR: ui,
    }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", () => {});
  child.stderr!.on("data", c => { stderr += c; });
  await until(async () => {
    if (child.exitCode !== null) throw new Error(stderr);
    try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
  }, Boolean);
});
afterAll(async () => {
  if (finishFile) writeFileSync(finishFile, "finish");
  await waitForExit(child, { signal: "SIGTERM" });
  if (fixtureHome) await removeTempDir(fixtureHome);
});
const bots: string[] = [];
const rooms: string[] = [];
afterEach(async () => {
  writeFileSync(finishFile, "finish");
  for (const id of rooms.splice(0)) await api("POST", `/api/groups/${id}/interrupt`, {});
  for (const id of bots.splice(0)) {
    await api("POST", `/api/bots/${id}/interrupt`, {}).catch(() => undefined);
    await idle(id).catch(() => undefined);
    await api("DELETE", `/api/bots/${id}`).catch(() => undefined);
  }
});
const makeBot = (name: string) => api("POST", "/api/bots", { name }).then(r => {
  bots.push(r.bot.id);
  return r.bot;
});
const makeRoom = async (name: string, botId: string) => {
  const { group } = await api("POST", "/api/groups", { name, memberIds: [botId],
    setup: { bulletin: "", defaultResponder: { kind: "member", botId } } });
  rooms.push(group.id);
  return group;
};
const roomIdle = (groupId: string) => until(() => api("GET", "/api/bots?messages=0"), s => s.groups.find((g: any) => g.id === groupId)?.working !== true);

describe("Lazy phone claim on the real server", () => {
  it("rejects a retained proxy after its turn settles, before and after a new owner claims", async () => {
    rmSync(finishFile, { force: true });
    const holder = await makeBot("Old retained phone caller");
    const spec = await holdDirectTurn(holder.id, "read my phone");
    await withPhoneMount(spec, async (oldCall) => {
      expect((await oldCall("status")).result.isError).toBeUndefined();
      writeFileSync(finishFile, "finish");
      await idle(holder.id);
      const afterSettlement = await oldCall("status");
      expect(afterSettlement.result.isError).toBe(true);
      expect(afterSettlement.result.content[0].text).toContain("no longer has phone access");
      rmSync(finishFile, { force: true });
      const next = await makeBot("New phone caller");
      const nextSpec = await holdDirectTurn(next.id, "read my phone");
      await withPhoneMount(nextSpec, async (newCall) => {
        expect((await newCall("status")).result.isError).toBeUndefined();
        const response = await oldCall("status");
        expect(response.result.isError, JSON.stringify(response)).toBe(true);
        expect(response.result.content[0].text).toContain("no longer has phone access");
      });
    });
  });
  it("mounts the phone for trigger words on both turn paths without claiming it", async () => {
    rmSync(finishFile, { force: true });
    const holder = await makeBot("Android words holder");
    const holderSpec = await holdDirectTurn(holder.id, "help me review this android build log");
    expect(holderSpec).toMatchObject({ type: "http", url: `${base}/api/internal/mcp-host/phone`, headers: { Authorization: expect.stringMatching(/^Bearer \S+$/) } });
    await busy(holder.id);

    const roomBot = await makeBot("Room phone words");
    const room = await makeRoom("Phone words room", roomBot.id);
    await holdRoomTurn(room.id, "draft a note about my mobile app plans");
    await until(() => api("GET", "/api/bots?messages=0"), s => s.groups.find((g: any) => g.id === room.id)?.working === true);

    const second = await makeBot("Second phone asker");
    await holdDirectTurn(second.id, "open uber on my phone");
    await busy(second.id);
    await noPhoneConflict(holder.id, roomBot.id, second.id);
  });

  it("holds no claim when the trigger word only appears in room history", async () => {
    rmSync(finishFile, { force: true });
    const roomBot = await makeBot("Room history android");
    const room = await makeRoom("Room history phone room", roomBot.id);
    await holdRoomTurn(room.id, "help me fix this android gradle error");
    writeFileSync(finishFile, "finish");
    await roomIdle(room.id);

    rmSync(finishFile, { force: true });
    await holdRoomTurn(room.id, "now give a short status update");
    await until(() => api("GET", "/api/bots?messages=0"), s => s.groups.find((g: any) => g.id === room.id)?.working === true);

    const other = await makeBot("Unrelated phone user");
    await holdDirectTurn(other.id, "open uber on my phone");
    await busy(other.id);
    await noPhoneConflict(roomBot.id, other.id);
  });

  it("claims at the first tool call, blocks the concurrent caller, and releases at turn end", async () => {
    rmSync(finishFile, { force: true });
    const holder = await makeBot("First phone caller");
    const holderSpec = await holdDirectTurn(holder.id, "read what is on my phone");
    const other = await makeBot("Concurrent phone caller");
    const otherSpec = await holdDirectTurn(other.id, "open uber on my phone");

    await withPhoneMount(holderSpec, async (call) => {
      const status = await call("status");
      expect(status.result.isError).toBeUndefined();
      expect(status.result.content[0].text).toContain("available");
    });
    // The holder's claim stands across its calls; the other's is refused while it does (the claim route's 409, below).
    await withPhoneMount(holderSpec, async (call) => expect((await call("status")).result.isError).toBeUndefined());

    await withPhoneMount(otherSpec, async (call) => {
      const blocked = await call("status");
      expect(blocked.result).toMatchObject({ isError: true });
      expect(blocked.result.content[0].text).toBe("Another thread is using the phone. This call was not performed. Pause phone work until that thread finishes, then read the screen again before acting.");
      await busy(other.id);
      await api("POST", `/api/bots/${holder.id}/interrupt`, {});
      await idle(holder.id);
      const retried = await call("status");
      expect(retried.result.isError).toBeUndefined();
      expect(retried.result.content[0].text).toContain("available");
    });
  });
});
