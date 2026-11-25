import type { SendTurnInput } from "../contracts.ts";
import type { ChatToolDefinition } from "./chat-mcp-tools.ts";
import type { Completion, OpenAIChatMessage } from "./openai-chat.ts";
import { ChatProtocolError } from "./openai-chat-protocol.ts";
import { classifyError } from "./retry.ts";

/** One streamed request of a chat-completions turn, on the AI that offers it. */
export type ChatCompletion = (request: {
  messages: OpenAIChatMessage[];
  model: string;
  signal: AbortSignal;
  tools: ChatToolDefinition[];
  effort?: SendTurnInput["effort"];
  onDelta: (text: string, kind: "assistant_text" | "reasoning_text") => void;
}) => Promise<Completion>;

/** Another chat-completions AI the bot may fall back to: it is sent the turn's own messages, the tool calls already run
 * and their results included, so the reply goes on where its AI failed instead of starting over. */
export interface ChatBackup {
  name: string;
  model: string;
  complete: ChatCompletion;
}

const MOVES: ReadonlySet<string> = new Set(["rate_limited", "quota", "overloaded", "server_error", "connection_reset", "timeout", "auth",
  "unknown_model", "not_found", "invalid_request"]);

/** A request its provider refused or never answered, which ran nothing and may go through on another AI: a limit, an
 * outage, a key or model the provider turned down. A provider's safety block, or the model's own reply, never moves. */
export function movesToBackup(error: unknown): boolean {
  if (!(error instanceof Error) || error instanceof ChatProtocolError || REFUSED_CONTENT.test(error.message)) return false;
  return MOVES.has(classifyError(error).reason);
}

const REFUSED_CONTENT = /content[_ ]?(?:policy|filter|management)|moderation|flagged|safety|prohibited|violat/i;

export const backupNotice = (from: string, to: string): string => `${from} didn't answer, so ${to} is carrying on with this reply.`;

/** The backups still untried for this turn, read once, on the first failure that needs one. */
export class TurnBackups {
  private left: ChatBackup[] | undefined;
  private readonly read: (() => readonly ChatBackup[]) | undefined;
  constructor(read: (() => readonly ChatBackup[]) | undefined) { this.read = read; }

  next(): ChatBackup | undefined {
    if (!this.left) {
      try { this.left = [...(this.read?.() ?? [])]; } catch { this.left = []; }
    }
    return this.left.shift();
  }
}
