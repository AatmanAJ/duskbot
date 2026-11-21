import { parseStoredMcpServer } from "./mcp-registry.ts";

type ListedBot = { id: string; mcpServers?: string[] };

/** The bot lists a new shared server joins: a server no bot owns is every bot's, so a bot whose own selection names some
 * servers gets it too. A bot whose selection is empty was given no servers on purpose and stays without. */
export function sharedServerJoins(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>>,
  bots: readonly ListedBot[],
): Array<{ botId: string; mcpServers: string[] }> {
  const added = Object.entries(after).flatMap(([name, raw]) => {
    if (before && Object.hasOwn(before, name)) return [];
    const parsed = parseStoredMcpServer(name, raw);
    return parsed.ok && !("bot" in parsed.server && parsed.server.bot) ? [name] : [];
  });
  if (!added.length) return [];
  return bots.flatMap((bot) => {
    if (!bot.mcpServers?.length) return [];
    const missing = added.filter((name) => !bot.mcpServers!.includes(name));
    return missing.length ? [{ botId: bot.id, mcpServers: [...bot.mcpServers, ...missing] }] : [];
  });
}
