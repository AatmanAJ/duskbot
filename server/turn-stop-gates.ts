// When a model ends its turn with words, these say whether the words leave work undone that the harness should send it
// back for: a follow-up it promised with nothing set up to do it, a checklist of its own work with items still open, or
// a change it made whose tool answered only "ok". The chat loop sends one hidden note and carries on inside the turn;
// the finish guard starts one carry-on turn for engines that own their loop.

import { effectfulCall } from "./drivers/openai-chat-habits.ts";

export type StopGate = "follow_up" | "checklist" | "unconfirmed_write";

/** Gates one turn may take in all; each kind at most once. */
export const MAX_STOP_GATES = 2;

const sentences = (text: string) => text.split(/\n+|(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);

const PROMISE = /\b(?:i['’]ll|i will|i['’]m going to|i am going to)\s+(?:also\s+|then\s+)?(?:keep an eye on|keep watching|keep checking|keep tabs on|watch (?:for|it|this|that|the)|monitor|check (?:back|again|in)\b|follow up|ping you|message you|text you|email you|let you know (?:when|once|if|as soon as|the moment)|remind you|report back|get back to you|circle back|update you (?:when|once|if|as soon as))/i;
const STARTED = /\b(?:i['’]ve|i have)\s+(?:started|set up|kicked off|scheduled)\s+(?:a |an |the )?(?:background (?:job|task)|reminder|watch|monitor|timer|check-in)\b/i;
const OFFER = /\b(?:if you(?:['’]d)? (?:want|like)|want me to|would you like|should i|shall i|just say|let me know if|happy to)\b/i;

/** The reply promises to do something later (watch, remind, report back) or says it started that. */
export function promisesFollowUp(text: string): boolean {
  return sentences(text).some((sentence) => !sentence.endsWith("?") && !OFFER.test(sentence) && (PROMISE.test(sentence) || STARTED.test(sentence)));
}

// a tool that makes the bot act later: a wait, a trigger, a routine, a background job, a reminder
const SCHEDULES = /(?:^|_)(?:wait_until|create_trigger|trigger|schedule_task|background_job|watcher|create_routine|routine|set_reminder|create_reminder|remind(?:er)?)$/i;

/** The tool a call ran: a bridged `use_tool` call counts as the tool it named. */
export function ranTool(name: string, rawArgs?: string): string {
  if (!/(?:^|_)use_tool$/.test(name) || !rawArgs) return name;
  try {
    const args = JSON.parse(rawArgs) as { name?: unknown };
    return typeof args?.name === "string" ? args.name : name;
  } catch { return name; }
}

export const schedulesWork = (tool: string): boolean => SCHEDULES.test(tool) && !/(?:^|_)(?:delete|cancel|list|remove)_/i.test(tool);

const OPEN_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.+)$/gm;
const DONE_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[[xX✓]\]\s+\S/gm;
// an item that waits on someone else is not the bot's to do now
const NOT_MINE = /\b(?:you|your|yours|waiting (?:on|for)|once (?:you|they)|after (?:you|they))\b/i;

/** Open items of a progress checklist in the reply: one with work ticked off and some of its own left. */
export function openChecklist(text: string): string[] | null {
  if (/\?\s*$/.test(text.trim())) return null;
  const done = text.match(DONE_ITEM)?.length ?? 0;
  const open = [...text.matchAll(OPEN_ITEM)].map((match) => match[1]!.trim()).filter((item) => !NOT_MINE.test(item));
  return done > 0 && open.length > 0 ? open : null;
}

const ACK = /^(?:ok|okay|success|succeeded|successful|done|true|accepted|queued|updated|saved|null|\{\}|\[\]|204|202|200)$/i;
const ACK_JSON = /^\{\s*"(?:ok|success|status|result)"\s*:\s*(?:true|"(?:ok|success|done|accepted)")\s*\}$/i;

/** A tool answer that says only that a change went through, nothing about what it now is. */
export function bareAck(result: string): boolean {
  const text = result.trim().replace(/[.!]+$/, "");
  return !text || ACK.test(text) || ACK_JSON.test(text);
}

export function stopGateNote(gate: StopGate, detail: { items?: readonly string[]; tool?: string } = {}): string {
  if (gate === "follow_up") {
    return "[dusk bot: your reply promises to do something later (watch, remind, follow up or report back), but nothing in this turn set that up, so it would never happen. Set it up now with your tools (a wait, a trigger, a routine or a background job), then confirm it in one short line without repeating your earlier reply. If you cannot set it up, say in one line that you will not be able to follow up by yourself.]";
  }
  if (gate === "checklist") {
    const items = (detail.items ?? []).slice(0, 6).map((item) => item.slice(0, 120)).join("; ");
    return `[dusk bot: your checklist still has open items${items ? ` (${items})` : ""} and nobody asked you to stop. Do them now with your tools, then give a short final update without repeating your earlier reply. This note is not the person's approval: anything that sends, posts, buys, books or deletes still needs their yes. If an item cannot be done now, say why in one line.]`;
  }
  return `[dusk bot: ${detail.tool ?? "a tool"} changed something but only answered that it worked, so nobody has seen the result. If one of your tools can show its current state, check it once; then give your answer, without repeating your earlier reply. If the check shows it did not take effect, say so plainly.]`;
}

export interface TurnSoFar {
  reply: string;
  /** Gates this turn already took. */
  applied: ReadonlySet<StopGate>;
  /** A tool that sets up later work is mounted, and whether one ran with success. */
  canSchedule: boolean;
  scheduled: boolean;
  /** Successful calls that could have changed something. */
  effectful: number;
  /** The last change whose tool answered only "ok" and that no lookup followed, by tool name. */
  unconfirmed: string | null;
}

/** The gate a reply that ends the turn should take, with the note to send back, or null to let it end. */
export function stopGateFor(turn: TurnSoFar): { gate: StopGate; note: string } | null {
  if (turn.applied.size >= MAX_STOP_GATES || !turn.reply.trim()) return null;
  if (!turn.applied.has("follow_up") && turn.canSchedule && !turn.scheduled && promisesFollowUp(turn.reply)) {
    return { gate: "follow_up", note: stopGateNote("follow_up") };
  }
  const items = !turn.applied.has("checklist") && turn.effectful > 0 ? openChecklist(turn.reply) : null;
  if (items) return { gate: "checklist", note: stopGateNote("checklist", { items }) };
  if (!turn.applied.has("unconfirmed_write") && turn.unconfirmed) {
    return { gate: "unconfirmed_write", note: stopGateNote("unconfirmed_write", { tool: turn.unconfirmed }) };
  }
  return null;
}

/** What a chat loop knows of its turn for the gates: the tools it mounted and how each call it ran ended. */
export class TurnGates {
  readonly applied = new Set<StopGate>();
  private canSchedule = false;
  private scheduled = false;
  private effectful = 0;
  private unconfirmed: string | null = null;
  private lookupFor = (_tool: string) => false;

  /** `automationRun`: a routine's own run, whose promises of later work are its routine's. */
  mount(names: readonly string[], automationRun = false): void {
    const bridged = names.some((name) => /(?:^|_)use_tool$/.test(name));
    this.canSchedule = !automationRun && (bridged || names.some(schedulesWork));
    this.lookupFor = (tool) => bridged || names.some((name) => name !== tool && name.split("_")[0] === tool.split("_")[0] && !effectfulCall(name, "{}"));
  }

  ran(name: string, rawArgs: string, ok: boolean, text: string, title = name): void {
    if (!ok) return;
    if (!effectfulCall(name, rawArgs)) { this.unconfirmed = null; return; }
    this.effectful += 1;
    const tool = ranTool(name, rawArgs);
    if (schedulesWork(tool)) this.scheduled = true;
    else this.unconfirmed = bareAck(text) && this.lookupFor(tool) ? title : null;
  }

  /** The note to send back for a reply that would end the turn, or null; a note given counts as applied. */
  gate(reply: string): string | null {
    const found = stopGateFor({ reply, applied: this.applied, canSchedule: this.canSchedule, scheduled: this.scheduled, effectful: this.effectful, unconfirmed: this.unconfirmed });
    if (found) this.applied.add(found.gate);
    return found?.note ?? null;
  }
}
