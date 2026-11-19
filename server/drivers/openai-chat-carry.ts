// A chat turn that a usage or rate limit cut off after it ran tools: the limit is reported the way every engine reports
// one, so the turn waits for the reset (or a backup the person chose takes it) through the shared limit hold, and the
// steps it ran ride into this conversation's next turn on this engine, so the resumed turn carries on instead of
// starting over.
import type { ChatToolCall } from "./openai-chat-protocol.ts";
import { classifyError } from "./retry.ts";

export interface CarriedMessage {
  role: "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

/** a limit reached by the turn's last request, as runtime.error's limit facts; null for any other failure */
export function chatLimitFacts(error: unknown, now = Date.now()): { limit: "engine"; limitResetsAt?: number } | null {
  const reason = classifyError(error instanceof Error ? error : { text: String(error) }).reason;
  if (reason !== "rate_limited" && reason !== "quota") return null;
  const asked = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  const after = typeof asked === "number" && asked > 0 ? asked : reason === "rate_limited" ? RATE_LIMIT_WAIT_MS : undefined;
  return { limit: "engine", ...(after ? { limitResetsAt: now + after } : {}) };
}

const RESULT_MAX = 2_000;
const RATE_LIMIT_WAIT_MS = 60_000;
const CARRY_MAX = 24_000;
const KEEP_MS = 8 * 24 * 60 * 60_000;
const THREADS_MAX = 64;

/** the turn's tool calls and their results after `from` (the turn's own request), whole pairs only, bounded */
export function carriedSteps(messages: ReadonlyArray<{ role: string; content?: unknown; tool_calls?: ChatToolCall[]; tool_call_id?: string }>, from: number): CarriedMessage[] {
  const out: CarriedMessage[] = [];
  let bytes = 0;
  for (let index = from + 1; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role !== "assistant" || !message.tool_calls?.length) continue;
    const ids = new Set(message.tool_calls.map((call) => call.id));
    const results = messages.slice(index + 1).filter((entry) => entry.role === "tool" && entry.tool_call_id && ids.has(entry.tool_call_id));
    if (results.length !== ids.size) break;
    const pair: CarriedMessage[] = [
      { role: "assistant", content: typeof message.content === "string" ? message.content : null, tool_calls: message.tool_calls },
      ...results.map((entry): CarriedMessage => ({ role: "tool", tool_call_id: entry.tool_call_id!, content: String(entry.content ?? "").slice(0, RESULT_MAX) })),
    ];
    const size = Buffer.byteLength(JSON.stringify(pair));
    if (bytes + size > CARRY_MAX) break;
    bytes += size;
    out.push(...pair);
  }
  return out;
}

/** per conversation, the steps a limited turn ran, taken once by the next turn there */
export function createCarriedWork(now: () => number = Date.now) {
  const kept = new Map<string, { at: number; steps: CarriedMessage[] }>();
  return {
    keep(threadId: string, steps: CarriedMessage[]): void {
      if (!steps.length) return;
      kept.delete(threadId);
      kept.set(threadId, { at: now(), steps });
      if (kept.size > THREADS_MAX) kept.delete(kept.keys().next().value!);
    },
    take(threadId: string): CarriedMessage[] {
      const entry = kept.get(threadId);
      kept.delete(threadId);
      return entry && now() - entry.at <= KEEP_MS ? entry.steps : [];
    },
  };
}
