import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-dusk.ts";
import { GROK_EXPORT_FORMAT, grokMovePlan, parseGrokExport } from "../shared/grok-import.ts";

type Bot = { id: string; name: string; mcpServers?: string[] };

const moved = (name: string, app: { name: string; mcp_url: string }) => {
  const [bot] = parseGrokExport(JSON.stringify({ format: GROK_EXPORT_FORMAT, version: 1, bots: [{ name, instructions: `You are ${name}.`, apps: [app] }] }));
  return grokMovePlan(bot!, { timeZone: "UTC" }).document;
};

it("gives the servers a moved bot brings to that bot alone, not to the bots already here", async () => {
  const fixture = await launchVerificationServer();
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${method} ${path}`).toBe(true);
    return response.json() as Promise<any>;
  };
  const selections = async () => Object.fromEntries(((await api("GET", "/api/bots")).bots as Bot[]).map((bot) => [bot.name, bot.mcpServers]));
  try {
    await api("POST", "/api/mcp/servers/import", { json: JSON.stringify({ mcpServers: { notes: { type: "http", url: "https://notes.example.test/mcp" } } }) });
    const { bot: picky } = await api("POST", "/api/bots", { name: "Picky" });
    await api("PATCH", `/api/bots/${picky.id}`, { mcpServers: ["notes"] });

    await api("POST", "/api/teams/import?mode=add", moved("Ada", { name: "Linear", mcp_url: "https://mcp.linear.app/sse" }));
    await api("POST", "/api/teams/import?mode=add", moved("Juniper", { name: "Stripe", mcp_url: "https://mcp.stripe.com" }));

    expect(((await api("GET", "/api/mcp/servers")).servers as Array<{ name: string }>).map((server) => server.name).sort()).toEqual(["linear", "notes", "stripe"]);
    expect(await selections()).toMatchObject({ Picky: ["notes"], Ada: ["linear"], Juniper: ["stripe"] });

    await api("POST", "/api/mcp/servers/import", { json: JSON.stringify({ mcpServers: { calendar: { type: "http", url: "https://calendar.example.test/mcp" } } }) });
    expect(await selections(), "a server added here is still every bot's").toMatchObject({
      Picky: ["notes", "calendar"], Ada: ["linear", "calendar"], Juniper: ["stripe", "calendar"],
    });
  } finally {
    await fixture.close();
  }
});
