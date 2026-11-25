// session_search's other-bots part: only in the catalog of a bot whose person let it read other bots' chats; every other
// catalog leaves the sentence and the bot property out.
export const OTHER_CHATS = " You may also read other bots' chats, read-only: pass bot only when another bot's chat likely holds what this request needs (what the person told it, what it found), never by habit.";

export function withoutOtherChats<T extends { description: string; inputSchema: { properties: Record<string, unknown> } }>(tool: T): T {
  const properties = Object.fromEntries(Object.entries(tool.inputSchema.properties).filter(([key]) => key !== "bot"));
  return { ...tool, description: tool.description.replace(OTHER_CHATS, ""), inputSchema: { ...tool.inputSchema, properties } };
}
