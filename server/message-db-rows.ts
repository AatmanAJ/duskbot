import type { DatabaseSync, StatementSync } from "node:sqlite";
import { AUTO_APPROVAL_REASONS } from "../shared/auto-approval.ts";
import { personWait } from "../shared/person-wait.ts";
import type { Message } from "./store.ts";

export interface ThreadRows {
  messages: Message[];
  activeLeafId: string | null;
}

export interface ThreadTailRows extends ThreadRows {
  hasMore?: boolean;
}

export const rowToMessage = (row: { json: string }): Message => JSON.parse(row.json) as Message;

/** The `limit` rows stored before `beforeId`, oldest first, or null when the thread holds no such row. */
export function threadRowsBefore(database: DatabaseSync, threadId: string, beforeId: string, limit: number): Required<ThreadTailRows> | null {
  const at = database.prepare("SELECT rowid FROM messages WHERE thread_id = ? AND id = ?").get(threadId, beforeId) as { rowid: number } | undefined;
  if (!at) return null;
  const rows = database.prepare("SELECT json FROM messages WHERE thread_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?").all(threadId, at.rowid, limit + 1) as Array<{ json: string }>;
  const hasMore = rows.length > limit;
  if (hasMore) rows.length = limit;
  rows.reverse();
  const state = database.prepare("SELECT active_leaf_id FROM thread_state WHERE thread_id = ?").get(threadId) as { active_leaf_id: string | null } | undefined;
  const newest = state?.active_leaf_id ? undefined : database.prepare("SELECT id FROM messages WHERE thread_id = ? ORDER BY rowid DESC LIMIT 1").get(threadId) as { id: string } | undefined;
  return { messages: rows.map(rowToMessage), activeLeafId: state?.active_leaf_id || (newest?.id ?? null), hasMore };
}

const previews = new WeakMap<DatabaseSync, StatementSync>();
const AUTO_APPROVAL_CHIP_SQL = AUTO_APPROVAL_REASONS.map((reason) => `json_extract(m.json, '$.tool.name') LIKE 'approved % (${reason})%'`).join(" OR ");
const PREVIEW_SQL = `WITH RECURSIVE
  recent AS MATERIALIZED (
    SELECT rowid AS ord, id, role, kind FROM messages WHERE thread_id = ? ORDER BY rowid DESC LIMIT ?
  ),
  links AS (
    SELECT r.*, CASE WHEN json_type(m.json, '$.parentId') IS NULL
      THEN (SELECT id FROM recent WHERE ord < r.ord ORDER BY ord DESC LIMIT 1)
      ELSE json_extract(m.json, '$.parentId') END AS parent
    FROM recent r JOIN messages m ON m.rowid = r.ord
  ),
  path(ord, id, role, kind, parent, depth) AS (
    SELECT ord, id, role, kind, parent, 0 FROM links
    WHERE id = COALESCE((SELECT active_leaf_id FROM thread_state WHERE thread_id = ?),
      (SELECT id FROM recent ORDER BY ord DESC LIMIT 1))
    UNION ALL
    SELECT r.ord, r.id, r.role, r.kind, r.parent, p.depth + 1
    FROM links r JOIN path p ON r.id = p.parent WHERE p.depth < ?
  ),
  branch AS (
    SELECT ord, role, kind, -depth AS pos FROM path
    UNION ALL SELECT ord, role, kind, ord AS pos FROM recent WHERE NOT EXISTS (SELECT 1 FROM path)
  ),
  picked AS (
    SELECT 'newest' AS pick, ord, pos FROM (
      SELECT b.ord, b.pos FROM branch b JOIN messages m ON m.rowid = b.ord
      WHERE b.kind NOT IN ('screen', 'digest', 'compaction', 'call')
        AND NOT (b.kind = 'activity' AND (${AUTO_APPROVAL_CHIP_SQL}))
      ORDER BY b.pos DESC LIMIT 1
    )
    UNION ALL SELECT 'person', ord, pos FROM (
      SELECT ord, pos FROM branch WHERE role = 'user' ORDER BY pos DESC LIMIT 1
    )
    UNION ALL SELECT 'quote', ord, pos FROM (
      SELECT ord, pos FROM branch WHERE role != 'user'
        AND kind NOT IN ('activity', 'screen', 'digest', 'compaction', 'call')
        AND pos > COALESCE((SELECT MAX(pos) FROM branch WHERE role = 'user'), -9223372036854775808)
      ORDER BY pos DESC LIMIT 1
    )
    UNION ALL SELECT 'wait', b.ord, b.pos FROM branch b JOIN messages m ON m.rowid = b.ord
      WHERE b.kind IN ('options', 'secret', 'signin', 'connector')
      AND (b.kind != 'options' OR (json_extract(m.json, '$.card.requestId') IS NOT NULL
        AND json_extract(m.json, '$.card.answered') IS NOT 1 AND json_extract(m.json, '$.card.dismissed') IS NOT 1
        AND json_extract(m.json, '$.card.expired') IS NOT 1))
  )
  SELECT p.pick, m.json, p.pos FROM picked p JOIN messages m ON m.rowid = p.ord ORDER BY p.pos DESC`;

export function threadPreviewRows(database: DatabaseSync, threadId: string, limit: number): Message[] {
  const count = Math.max(0, Math.min(200, Math.floor(limit)));
  if (!count) return [];
  let statement = previews.get(database);
  if (!statement) { statement = database.prepare(PREVIEW_SQL); previews.set(database, statement); }
  const rows = statement.all(threadId, count, threadId, count) as Array<{ pick: string; json: string; pos: number }>;
  const selected = new Map<string, { message: Message; pos: number }>();
  let waiting = false;
  for (const row of rows) {
    if (row.pick === "wait" && waiting) continue;
    const message = rowToMessage(row);
    if (row.pick === "wait") {
      if (!personWait(message)) continue;
      waiting = true;
    }
    selected.set(message.id, { message, pos: row.pos });
  }
  return [...selected.values()].sort((a, b) => a.pos - b.pos).map(({ message }) => message);
}
