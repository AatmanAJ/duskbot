type Hit = Record<string, unknown>;

/** A link the person can click to open an earlier one-to-one conversation of the bot's own; none for this conversation,
 * a room, or a hit private to the person. */
export function recallLink(hit: Hit): string {
  if (hit.current || hit.room || hit.crossed || typeof hit.task !== "string" || !hit.task || typeof hit.threadId !== "string") return "";
  return ` · link [#${hit.task.replace(/[[\]\\]/g, "\\$&")}](duskbot://thread/${encodeURIComponent(hit.threadId)})`;
}
