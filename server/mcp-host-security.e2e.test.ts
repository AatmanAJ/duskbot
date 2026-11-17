// What a warm engine's MCP credentials can reach, whatever carries them (a stdio relay's environment or an HTTP mount's
// headers): each thread's are its own, they work only while its turn runs, a tool selection narrows what the mounted
// servers list and run, and none of them reaches the server's log. The fake engine connects every server of its launch
// as Claude Code does and keeps a copy of each launch's MCP config.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlDusk } from "../scripts/control-dusk.ts";

type Entry = { command?: string; args?: string[]; env?: Record<string, string>; type?: string; url?: string; headers?: Record<string, string> };
type Config = { mcpServers: Record<string, Entry> };
type Reply = { result?: { isError?: boolean; tools?: Array<{ name: string }>; content?: unknown }; error?: { message?: string } };

const SECRET_NAME = /token|secret|password|authorization|key$/i;

/** Every credential an engine was handed: secret-named environment values and header values, bearer prefix removed. */
function credentials(entry: Entry): string[] {
  const values = [
    ...Object.entries(entry.env ?? {}).filter(([name]) => SECRET_NAME.test(name)).map(([, value]) => value),
    ...Object.entries(entry.headers ?? {}).filter(([name]) => SECRET_NAME.test(name)).map(([, value]) => value.replace(/^Bearer\s+/i, "")),
  ];
  return values.filter((value) => value.length >= 16);
}

const allCredentials = (config: Config) => Object.values(config.mcpServers).flatMap(credentials);

/** One request to a mounted server the way an engine would make it: initialize, then `request`. */
async function callMounted(entry: Entry, request: { method: string; params?: unknown }): Promise<Reply> {
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
  const call = { jsonrpc: "2.0", id: 2, ...request };
  if (entry.url) {
    const post = async (body: unknown) => {
      const response = await fetch(entry.url!, { method: "POST", body: JSON.stringify(body), headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream", ...entry.headers } });
      const text = await response.text();
      if (!response.ok) return { error: { message: `HTTP ${response.status} ${text}` } } as Reply;
      return text.trim() ? JSON.parse(text) as Reply : {};
    };
    const opened = await post(initialize);
    if (opened.error) return opened;
    await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    return post(call);
  }
  return new Promise((resolve) => {
    const child = spawn(entry.command!, entry.args ?? [], { env: { ...process.env, ...entry.env }, stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => { child.kill(); resolve({ error: { message: "timed out" } }); }, 30_000);
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      for (const line of buffer.split("\n").slice(0, -1)) {
        let frame: Reply & { id?: unknown };
        try { frame = JSON.parse(line); } catch { continue; }
        if (frame.id === 1) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify(call)}\n`);
        if (frame.id === 2) { clearTimeout(timer); child.kill(); resolve(frame); }
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    });
    child.on("exit", () => { clearTimeout(timer); resolve({ error: { message: "exited" } }); });
    child.stdin.on("error", () => {});
    child.stdin.write(`${JSON.stringify(initialize)}\n`);
  });
}

const succeeded = (reply: Reply) => !reply.error && reply.result?.isError !== true;
const listBots = { method: "tools/call", params: { name: "list_bots", arguments: {} } };
const listTools = { method: "tools/list", params: {} };

async function withFixture(run: (fixture: {
  url: string; logPath: string; dataDir: string;
  control(args: string[]): Promise<any>;
  api(method: string, path: string, body?: unknown): Promise<any>;
  configs(): Map<number, Config>;
}) => Promise<void>) {
  const scratch = mkdtempSync(join(tmpdir(), "dusk-mcp-security-"));
  const configDir = join(scratch, "configs");
  mkdirSync(configDir);
  const fixture = await launchVerificationServer({
    ...process.env,
    FAKE_CLAUDE_MODE: "hang",
    FAKE_CLAUDE_RELEASE: join(scratch, "release"),
    FAKE_CLAUDE_TOOL_CALLS: "[]",
    FAKE_CLAUDE_MCP_STARTUP: "1",
    FAKE_CLAUDE_MCP_CONFIG_DIR: configDir,
  });
  try {
    await run({
      url: fixture.info.url, logPath: fixture.info.logPath, dataDir: fixture.info.dataDir,
      control: (args) => runControlDusk([...args, "--url", fixture.info.url]),
      api: async (method, path, body) => {
        const response = await fetch(`${fixture.info.url}${path}`, { method, headers: { "content-type": "application/json", origin: fixture.info.url },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        return response.json();
      },
      configs: () => new Map(readdirSync(configDir).map((file) => [Number(file.replace(/\.json$/, "")), JSON.parse(readFileSync(join(configDir, file), "utf8")) as Config])),
    });
  } finally {
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Starts a hanging turn on `bot` and returns the MCP config its engine launched with. */
async function liveTurn(fixture: Parameters<Parameters<typeof withFixture>[0]>[0], bot: string): Promise<Config> {
  const before = new Set(fixture.configs().keys());
  await fixture.control(["send", "--bot", bot, "--text", "Hold on."]);
  let found: Config | undefined;
  await expect.poll(() => {
    found = [...fixture.configs()].find(([pid]) => !before.has(pid))?.[1];
    return found !== undefined;
  }, { timeout: 30_000 }).toBe(true);
  return found!;
}

it("gives each thread credentials of its own, honoured only while its turn runs and never logged", async () => {
  await withFixture(async (fixture) => {
    const [starter] = (await fixture.api("GET", "/api/bots")).bots as Array<{ id: string }>;
    const other = (await fixture.api("POST", "/api/bots", { useDefaults: false, name: "Second fixture" })).bot as { id: string };
    const first = await liveTurn(fixture, starter!.id);
    const second = await liveTurn(fixture, other.id);
    expect(Object.keys(first.mcpServers)).toEqual(expect.arrayContaining(["agents", "data"]));

    const mine = allCredentials(first);
    const theirs = allCredentials(second);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    for (const credential of mine) expect(JSON.stringify(second)).not.toContain(credential);
    for (const credential of theirs) expect(JSON.stringify(first)).not.toContain(credential);
    // One server's credential is never another's: a leaked data mount can't drive the agents tools.
    expect(credentials(first.mcpServers.agents!).filter((value) => credentials(first.mcpServers.data!).includes(value))).toEqual([]);

    for (const config of [first, second]) {
      expect(succeeded(await callMounted(config.mcpServers.agents!, listBots))).toBe(true);
      expect(succeeded(await callMounted(config.mcpServers.data!, listTools))).toBe(true);
    }

    await fixture.control(["interrupt", "--bot", starter!.id]);
    await expect.poll(async () => succeeded(await callMounted(first.mcpServers.agents!, listBots)), { timeout: 30_000 }).toBe(false);
    expect(succeeded(await callMounted(first.mcpServers.data!, listTools))).toBe(false);
    expect(succeeded(await callMounted(second.mcpServers.agents!, listBots))).toBe(true);
    expect(succeeded(await callMounted(second.mcpServers.data!, listTools))).toBe(true);

    await fixture.control(["interrupt", "--bot", other.id]);
    const logs = [fixture.logPath, ...readdirSync(fixture.dataDir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".log")).map((file) => join(fixture.dataDir, file))].filter((file) => existsSync(file));
    const logged = logs.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(logged.length).toBeGreaterThan(0);
    for (const credential of [...mine, ...theirs]) expect(logged).not.toContain(credential);
  });
}, 180_000);

it("lets a tool selection narrow what each mounted server lists and runs", async () => {
  await withFixture(async (fixture) => {
    const bot = (await fixture.api("POST", "/api/bots", { useDefaults: false, name: "Selected fixture" })).bot as { id: string };
    const scoped = await fixture.api("PATCH", `/api/bots/${bot.id}`, { toolScope: { allow: ["mcp:agents:list_bots", "mcp:dusk:*", "native:*"] } });
    expect(scoped.bot.toolScope).toBeDefined();
    const config = await liveTurn(fixture, bot.id);
    expect(Object.keys(config.mcpServers)).not.toContain("data");
    const listed = await callMounted(config.mcpServers.agents!, listTools);
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual(["list_bots"]);
    expect(succeeded(await callMounted(config.mcpServers.agents!, listBots))).toBe(true);
    expect(succeeded(await callMounted(config.mcpServers.agents!, { method: "tools/call", params: { name: "create_bot", arguments: { name: "Escaped" } } }))).toBe(false);
    const bots = (await fixture.api("GET", "/api/bots")).bots as Array<{ name: string }>;
    expect(bots.map((row) => row.name)).not.toContain("Escaped");
    await fixture.control(["interrupt", "--bot", bot.id]);
  });
}, 180_000);
