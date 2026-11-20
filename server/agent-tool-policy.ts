/** The reviewed local reads of the built-in agents MCP. Names, prefixes or third-party annotations alone must never grant
 * read access; session recall keeps its own-bot scope. */
export const READ_ONLY_AGENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "list_bots",
  "list_team_setup",
  "list_rooms",
  "list_threads",
  "assignment_status",
  "session_search",
  "tool_result_read",
  "trigger_info",
  "list_waits",
  "skills_list",
  "list_unread_notifications",
  "usage_limits",
  "list_documents",
  "list_room_targets",
  "list_team_library",
  "set_status",
  "send_message",
]);

/** The reviewed reads that reach past this workspace (X, the research catalog, a decision or extraction model): they
 * change nothing, so they may run beside other reads, but some are paid. */
export const OPEN_WORLD_AGENT_READ_NAMES: ReadonlySet<string> = new Set([
  "web_search_many",
  "read_pages",
  "x_search",
  "research_search",
  "research_endpoint",
  "extract",
  "decide",
]);

export const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const);

export const OPEN_WORLD_READ_ANNOTATIONS = Object.freeze({ ...READ_ONLY_ANNOTATIONS, openWorldHint: true } as const);

export function isReadOnlyAgentTool(name: string): boolean {
  return READ_ONLY_AGENT_TOOL_NAMES.has(name) || OPEN_WORLD_AGENT_READ_NAMES.has(name);
}

export function agentToolAnnotations(name: string): typeof READ_ONLY_ANNOTATIONS | typeof OPEN_WORLD_READ_ANNOTATIONS | undefined {
  if (READ_ONLY_AGENT_TOOL_NAMES.has(name)) return READ_ONLY_ANNOTATIONS;
  return OPEN_WORLD_AGENT_READ_NAMES.has(name) ? OPEN_WORLD_READ_ANNOTATIONS : undefined;
}
