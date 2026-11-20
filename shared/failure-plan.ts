// what a failed reply turns into for a person: what dusk bot tries by itself first, then one sentence and one button.
// the desktop words these in the reader's language; `line` is the English a phone shows.
import { failedTurnCause, type FailedReplyReason, type FailedTurnTool } from "./failed-turn.ts";

/** Every way a reply can be lost, as the apps tell them apart: the server's reasons, plus what a client reads from the
 * row itself (`place`: the bot's computer or browser could not be used; `blocker`: dusk bot stopped a browser run that
 * kept failing; `no_answer`: the AI never replied; `other`: none of these). */
export type FailureKind = FailedReplyReason | "claude_update" | "place" | "restart_interrupted" | "no_answer" | "blocker" | "other";

/** The named kinds a person tells failures apart by. Every FailureKind is one of these, and each has one plain
 * sentence and one button; a usage limit is a notice, never an error. */
export type ErrorKind = "signed_out" | "out_of_credit" | "usage_limit" | "busy" | "no_reply" | "model" | "chat_full" | "ai_setup"
  | "no_ai" | "computer" | "repeating" | "interrupted" | "other";

export const ERROR_KIND_OF: Readonly<Record<FailureKind, ErrorKind>> = {
  signed_out: "signed_out",
  credits: "out_of_credit",
  usage_limit: "usage_limit",
  rate_limit: "busy",
  overloaded: "busy",
  provider_down: "busy",
  timeout: "no_reply",
  no_answer: "no_reply",
  cli_exit: "no_reply",
  model_not_found: "model",
  bad_request: "model",
  context: "chat_full",
  session_lost: "chat_full",
  cli_missing: "ai_setup",
  claude_update: "ai_setup",
  no_ai: "no_ai",
  place: "computer",
  blocker: "repeating",
  restart_interrupted: "interrupted",
  other: "other",
};

export function errorKind(kind: FailureKind | undefined): ErrorKind {
  return (kind && ERROR_KIND_OF[kind]) || "other";
}

/** What dusk bot does on its own before a card is shown: `retry`, the same AI again after a short wait; `backup`, the
 * next backup AI for the bot; `wait`, the turn holds until the AI's limit resets and carries on. */
export type FailureHeal = "retry" | "backup" | "wait";

/** The one button a failure card offers. */
export type FailureAction =
  | "retry"
  | "sign_in"
  | "connect_ai"
  | "switch_ai"
  | "update_engine"
  | "set_up_engine"
  | "new_chat"
  | "continue_after_reset"
  | "place"
  | "take_over"
  | "open_ais";

export interface FailurePlan {
  heal: readonly FailureHeal[];
  action: FailureAction;
  /** the button when `action` can't be offered here (no message to send again, no known reset, a group chat) */
  instead?: FailureAction;
  /** a quiet second button beside it, for what comes right after the fix */
  after?: FailureAction;
  /** the English sentence a client without translations shows: plain words, what to do next */
  line: string;
}

export const FAILURE_PLANS: Readonly<Record<ErrorKind, FailurePlan>> = {
  signed_out: { heal: ["backup"], action: "sign_in", after: "retry", line: "Your AI is signed out. Sign in again to keep going." },
  out_of_credit: { heal: ["backup"], action: "switch_ai", line: "Your AI account is out of credit. Add credit there, or switch this bot to another AI." },
  usage_limit: { heal: ["backup", "wait"], action: "continue_after_reset", instead: "switch_ai", line: "This carries on once your AI's limit resets, or switch this bot to another AI now." },
  busy: { heal: ["retry", "backup"], action: "retry", instead: "switch_ai", line: "Your AI is busy right now. Try again in a moment." },
  no_reply: { heal: ["retry", "backup"], action: "retry", instead: "switch_ai", line: "Your AI didn't reply. Try again." },
  model: { heal: ["backup"], action: "switch_ai", instead: "retry", line: "Your AI couldn't answer with this model. Pick another model for this bot." },
  chat_full: { heal: [], action: "new_chat", instead: "switch_ai", line: "Your AI can't keep going in this chat. Start a new chat to carry on." },
  ai_setup: { heal: ["backup"], action: "set_up_engine", line: "Your AI isn't ready where this bot runs. Set it up again to keep going." },
  no_ai: { heal: [], action: "connect_ai", after: "retry", line: "The free backup is busy. Connect an AI you already use to keep chatting." },
  computer: { heal: [], action: "place", instead: "retry", line: "Your bot couldn't use its computer. Try again in a minute." },
  repeating: { heal: [], action: "take_over", line: "Your bot stopped so it doesn't keep repeating the same step." },
  interrupted: { heal: [], action: "retry", line: "dusk bot restarted while this was running. Some steps may already be done." },
  other: { heal: [], action: "retry", instead: "switch_ai", line: "Your bot couldn't finish this reply. Try again." },
};

export function failurePlan(kind: FailureKind | undefined): FailurePlan {
  return FAILURE_PLANS[errorKind(kind)];
}

// the runtime's own words for a turn a restart cut (server/runtime/tree.ts CUT_TWICE, INTERRUPTED_OUTWARD)
const RESTART_CUT = /^(?:turn )?Interrupted by (?:another |an? )?dusk bot restart\b|^turn interrupted: dusk bot restarted\b/i;
const SIGNED_OUT_WORDS = /not logged in|logged out|\/login|not signed in|sign in again|authentication required|unauthori[sz]ed|invalid api key|\b401\b/i;
const USAGE_WORDS = /usage limit|limit reached|hit your [\w' -]{0,30}limit/i;
const SESSION_LOST_WORDS = /\bNo conversation found with session ID\b/i;
const CREDIT_WORDS = /out of credits?|payment required|insufficient (?:funds|balance|credits?)/i;
const RATE_WORDS = /\b429\b|rate.?limit|too many requests/i;
const BUSY_WORDS = /overloaded|\b529\b|\b503\b|capacity|service unavailable/i;
const SLOW_WORDS = /timeout|timed out|ETIMEDOUT/i;

/** The one reading of a failed row: its own flags and the reason the server stored, then, for a row stored before the
 * server kept a reason, its words. Clients and the server's log both read rows with this. */
export function rowFailureKind(tool: Pick<FailedTurnTool, "name" | "reason" | "setup" | "place" | "blocker" | "claudeUpdate" | "limitResetsAt"> & { rescue?: unknown }): FailureKind {
  if (tool.rescue) return "no_answer";
  if (tool.blocker) return "blocker";
  const cause = failedTurnCause(tool.name) ?? tool.name;
  if (tool.place) return "place";
  if (tool.claudeUpdate) return "claude_update";
  if (RESTART_CUT.test(cause)) return "restart_interrupted";
  if (tool.reason) return tool.reason;
  return CREDIT_WORDS.test(cause) ? "credits"
    : tool.limitResetsAt || USAGE_WORDS.test(cause) ? "usage_limit"
    : tool.setup && SIGNED_OUT_WORDS.test(cause) ? "signed_out"
    : SESSION_LOST_WORDS.test(cause) ? "session_lost"
    : RATE_WORDS.test(cause) ? "rate_limit"
    : BUSY_WORDS.test(cause) ? "overloaded"
    : SLOW_WORDS.test(cause) ? "timeout"
    : "other";
}

// Crockford base32 without 0/1, so a code read aloud or retyped can't be mistaken: no I, L, O, U, 0 or 1
const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const REF = /^D-[2-9A-HJKMNP-TV-Z]{4}$/;

/** A short code a person can quote to support, logged by the server beside the failure's real cause: "D-7F3K". */
export function newErrorRef(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 4; i += 1) code += REF_ALPHABET[Math.floor(random() * REF_ALPHABET.length)];
  return `D-${code}`;
}

export function isErrorRef(value: unknown): value is string {
  return typeof value === "string" && REF.test(value);
}
