import type { RuntimeEvent } from "../contracts.ts";
import { classifyError } from "./retry.ts";

/** A model whose provider failed a turn before it did anything is skipped this long, unless a turn on it works first. */
export const PROVIDER_FAILURE_HOLD_MS = 10 * 60_000;

const PROVIDER_REASONS: ReadonlySet<string> = new Set(["rate_limited", "overloaded", "server_error", "connection_reset", "timeout"]);

/** The turn failed on the provider's side (an outage, overload, rate limit, dropped connection or timeout) after the
 * engine's own retries, or the provider does not offer the model: never a usage limit, a sign-in, a refused request or
 * a safety block. */
export function providerFailure(cause: string | undefined, stopReason?: string | null): boolean {
  if (!cause || stopReason === "tool_error" || stopReason === "provider_safety") return false;
  const verdict = classifyError({ text: cause });
  return (verdict.transient && PROVIDER_REASONS.has(verdict.reason)) || verdict.reason === "unknown_model";
}

/** Something the person could see or that may have changed something: words of the reply, a tool, an ask. */
export function turnActed(event: RuntimeEvent): boolean {
  switch (event.type) {
    case "content.delta":
      return event.streamKind === "assistant_text" && Boolean(event.delta);
    case "item.started":
      return event.itemType === "tool";
    case "item.completed":
      return (event.itemType === "assistant_text" && !event.synthetic && Boolean(event.text?.trim())) || event.itemType === "assistant_image" || event.itemType === "tool";
    case "request.opened":
      return true;
    default:
      return false;
  }
}

/** "Claude did not answer, so Codex took over." */
export function providerFailoverLine(from: string, to: string): string {
  return `${from} did not answer, so ${to} took over.`;
}

export function providerBackLine(engine: string): string {
  return `${engine} gets another try, so this conversation is back on ${engine}.`;
}
