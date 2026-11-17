// A person changes settings by asking their bot: from inside the bot's own running turn, through the mounted agents
// proxy, the bot renames itself and changes its colour and reply style, switches its own model, sets the person's theme
// and makes and then changes a routine. Each change is read back from the server.
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { z } from "zod";

import { launchVerificationServer, runControlDusk } from "../scripts/control-dusk.ts";
import { openMcp, type McpConnection } from "./testing/fake-mcp-client.ts";

type Reply = { isError?: boolean; content: Array<{ text: string }> };
const mountSchema = z.object({ mcpConfig: z.object({ mcpServers: z.object({
  agents: z.object({ type: z.literal("http"), url: z.string().endsWith("/api/internal/mcp-host/agents"), headers: z.record(z.string(), z.string()) }),
}) }) });

it("a bot changes its own settings, the person's theme and a routine from inside its own turn", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  const connections: McpConnection[] = [];
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${fixture.info.url}${path}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(response.ok, `${method} ${path}`).toBe(true);
    return await response.json() as T;
  };
  const control = (args: string[]) => runControlDusk([...args, "--url", fixture.info.url]);
  try {
    const { bot } = await control(["new-bot", "--name", "Scout"]) as { bot: { id: string; threadId: string } };
    await control(["send", "--bot", bot.id, "--text", "Call yourself Scout Prime, go teal, keep replies short, and use a different model."]);
    await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 15_000 }).toBe(true);
    const mounted = mountSchema.parse(JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"))).mcpConfig.mcpServers.agents;
    const connection = openMcp(mounted);
    connections.push(connection);
    await connection.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "settings-by-talking", version: "1" } });
    const tool = async (name: string, args: Record<string, unknown>) => {
      const timeout = new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`${name} did not answer`)), 10_000).unref());
      const reply = await Promise.race([connection.call("tools/call", { name, arguments: args }), timeout]);
      const result = reply.result as Reply | undefined;
      if (!result || result.isError) throw new Error(`${name}: ${JSON.stringify(reply)}`);
      return result.content.map((item) => item.text).join("\n");
    };
    const self = async () => (await api<{ bots: Array<Record<string, any>> }>("GET", "/api/bots?messages=0")).bots.find((one) => one.id === bot.id)!;
    expect((await self()).busy).toBe(true);

    await tool("propose_profile", { name: "Scout Prime", color: "teal", replyStyle: "conversational", reason: "The person asked." });
    expect(await self()).toMatchObject({ name: "Scout Prime", color: "teal", replyStyle: "conversational" });

    const before = (await self()).modelSelection as { instanceId: string; model: string };
    const { instances } = await api<{ instances: Array<{ instanceId: string; models: { options: Array<{ id: string }> } }> }>("GET", "/api/instances");
    const other = instances.find((one) => one.instanceId === before.instanceId)!.models.options.find((option) => option.id !== before.model)!.id;
    await tool("propose_model", { model_selection: { instanceId: before.instanceId, model: other }, reason: "The person asked." });
    expect((await self()).modelSelection).toMatchObject({ instanceId: before.instanceId, model: other });

    expect(await tool("app_settings", { action: "set", setting: "theme", value: "midnight" })).toContain("Set theme to midnight");
    const { prefs } = await api<{ prefs: Record<string, { value: string | null }> }>("GET", "/api/settings-sync/ui");
    expect(prefs["dusk-skin"]?.value).toBe("midnight");

    await tool("trigger", { action: "create", when: "schedule", name: "Morning brief", instructions: "Send me the day's plan.", schedule: { type: "daily", time: "08:00" } });
    const routine = async () => (await api<{ routines: Array<{ id: string; name: string; botId: string }> }>("GET", "/api/routines")).routines.find((one) => one.botId === bot.id);
    await expect.poll(async () => (await routine())?.name, { timeout: 10_000 }).toBe("Morning brief");
    await tool("trigger", { action: "update", trigger_id: (await routine())!.id, name: "Early brief", schedule: { type: "daily", time: "07:00" } });
    await expect.poll(async () => (await routine())?.name, { timeout: 10_000 }).toBe("Early brief");
    expect((await self()).busy).toBe(true);
    await control(["interrupt", "--bot", bot.id]);
  } finally {
    for (const connection of connections) await connection.close();
    await fixture.close();
  }
}, 90_000);
