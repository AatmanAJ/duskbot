import type { Bot, Message } from "@/state/store";
import type { TurnLive } from "@/state/turn-status";
import { replyFirstLine, turnActivityEnded, type TurnActivityState } from "../../shared/phone-activity";

const STEPS = new Set(["write", "edit", "command", "web", "read", "fetch", "search", "tool"]);

/** The rows of the newest turn: everything after the person's last message. */
function turnRows(messages: readonly Message[]): Message[] {
  return messages.slice(messages.findLastIndex((message) => message.role === "user") + 1);
}

function openAsk(rows: readonly Message[]): TurnActivityState["ask"] {
  const card = rows.findLast((message) => message.card?.requestId && !message.card.answered && !message.card.dismissed && !message.card.expired)?.card;
  return card?.requestId ? { kind: card.requestType === "permission" ? "approve" : "answer", requestId: card.requestId } : undefined;
}

/** Whether the bot is on this turn at all: the app has seen it busy, or the turn's live status. */
export function turnUnderway(bot: Bot, live: TurnLive): boolean {
  return Boolean(bot.busy) || bot.activity === "working" || bot.activity === "waiting-on-you" || (live.status !== null && !live.ended);
}

/** The Live Activity as the open app sees the turn: the same shape the bot host pushes, plus the reply's first line once
 * it is done. Steps never count down below what a push already showed. */
export function localTurnActivity(prev: TurnActivityState, bot: Bot, live: TurnLive): TurnActivityState {
  if (turnActivityEnded(prev)) return prev;
  const rows = turnRows(bot.messages);
  const steps = Math.max(prev.steps, rows.filter((message) => message.kind === "activity" && message.tool && !message.tool.setup).length);
  const base = { startedAt: prev.startedAt, steps };
  if (!turnUnderway(bot, live)) {
    const reply = rows.findLast((message) => message.role === "bot" && message.kind === "text" && message.text?.trim())?.text ?? "";
    const line = replyFirstLine(reply);
    return { ...base, phase: "done", ...(line ? { line } : {}) };
  }
  const ask = bot.activity === "waiting-on-you" ? openAsk(rows) : undefined;
  if (ask) return { ...base, phase: "needs-you", ask };
  const step = live.status && STEPS.has(live.status.activity) ? live.status.activity as TurnActivityState["step"] : undefined;
  return { ...base, phase: "working", ...(step ? { step } : {}) };
}

export function sameTurnActivity(a: TurnActivityState, b: TurnActivityState): boolean {
  return a.phase === b.phase && a.step === b.step && a.steps === b.steps && a.ask?.requestId === b.ask?.requestId && a.ask?.kind === b.ask?.kind && a.line === b.line;
}
