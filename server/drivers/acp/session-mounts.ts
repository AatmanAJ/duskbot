// The tool set each thread's native session was opened or last resumed with, kept across restarts: agents connect a
// session's MCP servers when it opens, and a session/load or session/resume, even in a new process, may keep the list
// the session was saved with.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../../config.ts";
import { writeFileAtomicIfChanged } from "../../atomic.ts";
import type { AcpSession } from "./turn-state.ts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const recordPath = (scope: string, threadId: string) => join(DATA_DIR, "acp-mounts", `${digest(JSON.stringify([scope, threadId]))}.json`);

function savedMount(scope: string, threadId: string, sessionId: string): string | null {
  try {
    const record = JSON.parse(readFileSync(recordPath(scope, threadId), "utf8")) as { sessionId?: unknown; mount?: unknown };
    return record.sessionId === sessionId && typeof record.mount === "string" ? record.mount : null;
  } catch {
    return null;
  }
}

/** Whether this turn's tool set differs from the one the thread's session holds, live or saved: such a session is not
 * resumed but replaced by a new one that carries the conversation as a replay. A session with no record resumes. */
export function mountChanged(scope: string, threadId: string, cursor: unknown, mountKey: string, live?: Pick<AcpSession, "mountKey">): boolean {
  if (live?.mountKey) return live.mountKey !== mountKey;
  const saved = typeof cursor === "string" ? savedMount(scope, threadId, cursor) : null;
  return saved !== null && saved !== digest(mountKey);
}

export function recordMount(scope: string, threadId: string, sessionId: string | null, mountKey: string): void {
  if (!sessionId) return;
  try {
    mkdirSync(join(DATA_DIR, "acp-mounts"), { recursive: true });
    writeFileAtomicIfChanged(recordPath(scope, threadId), JSON.stringify({ sessionId, mount: digest(mountKey) }), { mode: 0o600, durable: false });
  } catch {}
}
