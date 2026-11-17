// The bot's own words for its status line, from its set_status tool, and its choice of sound for this turn's notice, from
// set_notification_sound, however an engine spells or bridges the call. Neither call is a step: the bus logs it but
// delivers only the label it sets.
import { STATUS_LABEL_MAX, STATUS_TOOL } from "../../shared/turn-progress.ts";
import { SERVER_PREFIXES, USE_TOOL } from "../drivers/agents-bridge.ts";
import { SEND_MESSAGE_TOOL } from "../drivers/agents-send-message-tool.ts";
import { isNotificationSound, NOTIFICATION_SOUND_TOOL } from "../drivers/agents-sound-tool.ts";
import type { NotificationSound } from "../../shared/notification.ts";
import { newId, type RuntimeEvent } from "../contracts.ts";
import { redactSecretsInText } from "../redact.ts";
import { derivedLabel, LABEL_HOLD_MS, MODEL_HOLD_MS } from "./derived-status.ts";
import type { ProgressEvent } from "./progress-gate.ts";

type Args = Record<string, unknown>;

function record(value: unknown): value is Args {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bareName(title: string | undefined): string {
  const name = (title ?? "").trim().replace(/^mcp__.+?__/, "");
  const prefix = SERVER_PREFIXES.find((spelling) => spelling && name.startsWith(spelling));
  return prefix ? name.slice(prefix.length) : name;
}

/** A tool name, in any engine's spelling, that is the set_status tool itself. */
export function isStatusToolName(title: string | undefined): boolean {
  return bareName(title) === STATUS_TOOL;
}

function parsed(input: unknown): unknown {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

// A driver's preview may be cut short, so the fields are also read from the text as far as it goes.
const NAME_FIELD = /"name"\s*:\s*"set_status"/;
const STATUS_FIELD = /"status"\s*:\s*"((?:[^"\\]|\\.)*)/;

function statusField(args: unknown, input: unknown): string | undefined {
  if (record(args)) return typeof args.status === "string" ? args.status : undefined;
  const match = typeof input === "string" ? STATUS_FIELD.exec(input) : null;
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1].replace(/\\$/, "")}"`);
  } catch {
    return match[1];
  }
}

/** A tool call's status text when the call is set_status (directly, or through the bridge's use_tool); `null` for any
 * other call. The text is undefined when the call names no readable status. */
export function statusCallText(title: string | undefined, input: unknown): string | undefined | null {
  const name = bareName(title);
  const args = parsed(input);
  if (name === STATUS_TOOL) return statusField(args, input);
  if (name !== USE_TOOL) return null;
  if (record(args)) return args.name === STATUS_TOOL ? statusField(record(args.arguments) ? args.arguments : {}, undefined) : null;
  return typeof input === "string" && NAME_FIELD.test(input) ? statusField(undefined, input) : null;
}

/** A send_message call's text, through the bridge's use_tool too; `null` for any other call, undefined when it names none
 * that can be read whole. */
export function sentMessageText(title: string | undefined, input: unknown): string | undefined | null {
  const name = bareName(title);
  const args = parsed(input);
  const text = (value: unknown) => (record(value) && typeof value.text === "string" && value.text.trim() ? value.text : undefined);
  if (name === SEND_MESSAGE_TOOL) return text(args);
  if (name === USE_TOOL && record(args) && args.name === SEND_MESSAGE_TOOL) return text(args.arguments);
  return null;
}

const SOUND_FIELD = /"sound"\s*:\s*"(quiet|ding)"/;

/** A set_notification_sound call's choice, through the bridge's use_tool too; `null` for any other call, undefined when
 * it names no sound that can be read. */
export function notificationSoundCall(title: string | undefined, input: unknown): NotificationSound | undefined | null {
  const name = bareName(title);
  const args = parsed(input);
  const sound = (value: unknown, raw: unknown) => {
    if (record(value)) return isNotificationSound(value.sound) ? value.sound : undefined;
    const match = typeof raw === "string" ? SOUND_FIELD.exec(raw) : null;
    return match ? match[1] as NotificationSound : undefined;
  };
  if (name === NOTIFICATION_SOUND_TOOL) return sound(args, input);
  if (name !== USE_TOOL) return null;
  if (record(args)) return args.name === NOTIFICATION_SOUND_TOOL ? sound(record(args.arguments) ? args.arguments : {}, undefined) : null;
  return typeof input === "string" && input.includes(`"${NOTIFICATION_SOUND_TOOL}"`) ? sound(undefined, input) : null;
}

const TRAILING = /[\s.,;:!?…]+$/u;

/** The status line's label for what the bot said: no leading "is ", sentence case, no trailing punctuation or ellipsis,
 * redacted, and at most STATUS_LABEL_MAX characters, cut at a word. */
export function statusLabel(text: string | undefined): string | undefined {
  if (typeof text !== "string") return undefined;
  let label = redactSecretsInText(text.replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim())
    .replace(/^is\s+/i, "").replace(TRAILING, "");
  if (label.length > STATUS_LABEL_MAX) {
    const cut = label.slice(0, STATUS_LABEL_MAX + 1);
    const space = cut.lastIndexOf(" ");
    label = (space > 0 ? cut.slice(0, space) : cut.slice(0, STATUS_LABEL_MAX)).replace(TRAILING, "");
  }
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined;
}

type Started = Extract<RuntimeEvent, { type: "item.started" }>;

export interface TurnStatusOptions {
  /** Sends a label frame derived later than the call that asked for it. Without it no label is derived. */
  emit?: (frame: ProgressEvent) => void;
  /** The language of the person a thread's derived labels are for. */
  language?: (threadId: string) => string | undefined;
  now?: () => number;
}

interface Derived {
  turnId?: string;
  shownAt: number;
  site?: string;
  /** When the bot last set its own label. */
  setAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** Each thread's label for its running turn, and its set_status calls, which no listener sees as a tool call. While the
 * bot sets no label, its tool calls give one (derived-status.ts), changing at most once every LABEL_HOLD_MS. */
export class TurnStatus {
  private readonly labels = new Map<string, { turnId?: string; label: string }>();
  private readonly calls = new Map<string, Set<string>>();
  private readonly sounds = new Map<string, NotificationSound>();
  private readonly derived = new Map<string, Derived>();
  private readonly options: TurnStatusOptions;
  private readonly now: () => number;

  constructor(options: TurnStatusOptions = {}) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** True for a set_status call's start, update or end: the bus logs it and delivers nothing. A start that names a
   * status also sets the turn's label and gives the frame that shows it. */
  take(event: RuntimeEvent): { frame?: ProgressEvent; message?: RuntimeEvent } | null {
    if (event.type === "item.started" && event.itemType === "tool") {
      const sent = sentMessageText(event.title, event.input);
      if (typeof sent === "string") {
        this.hold(event);
        return {
          message: {
            eventId: newId(), provider: event.provider, providerInstanceId: event.providerInstanceId, threadId: event.threadId,
            createdAt: event.createdAt, turnId: event.turnId, type: "item.completed", itemType: "assistant_text", text: sent,
          } as RuntimeEvent,
        };
      }
      const sound = notificationSoundCall(event.title, event.input);
      if (sound !== null) {
        this.hold(event);
        if (sound) this.sounds.set(event.threadId, sound);
        return {};
      }
      const text = statusCallText(event.title, event.input);
      if (text === null) return null;
      this.hold(event);
      const label = statusLabel(text);
      if (!label) return {};
      this.labels.set(event.threadId, { turnId: event.turnId, label });
      const derived = this.derivedFor(event.threadId, event.turnId);
      clearTimeout(derived.timer);
      derived.timer = undefined;
      derived.setAt = this.now();
      return {
        frame: {
          eventId: newId(), provider: event.provider, providerInstanceId: event.providerInstanceId, threadId: event.threadId,
          createdAt: event.createdAt, turnId: event.turnId, type: "turn.progress", activity: "tool", tool: STATUS_TOOL, label,
        },
      };
    }
    if ((event.type === "item.completed" || event.type === "item.updated") && event.itemType === "tool" && event.itemId) {
      const calls = this.calls.get(event.threadId);
      if (!calls?.has(event.itemId)) return null;
      if (event.type === "item.completed") calls.delete(event.itemId);
      return {};
    }
    return null;
  }

  private hold(event: Started): void {
    if (!event.itemId) return;
    let calls = this.calls.get(event.threadId);
    if (!calls) this.calls.set(event.threadId, (calls = new Set()));
    calls.add(event.itemId);
  }

  /** An engine's own report of a set_status, send_message or set_notification_sound call being written: never a step on the status line. */
  hides(event: ProgressEvent): boolean {
    const name = bareName(event.tool);
    return event.label === undefined && (isStatusToolName(event.tool) || name === SEND_MESSAGE_TOOL || name === NOTIFICATION_SOUND_TOOL);
  }

  /** A frame of the turn carries the label the bot set last. */
  stamp(event: ProgressEvent): ProgressEvent {
    if (event.label !== undefined) return event;
    const held = this.labels.get(event.threadId);
    if (!held || (held.turnId && event.turnId && held.turnId !== event.turnId)) return event;
    return { ...event, label: held.label };
  }

  /** A tool call starting: its label, when one can be said and the bot's own does not stand. */
  derive(event: Started): void {
    if (!this.options.emit || event.itemType !== "tool") return;
    const held = this.derivedFor(event.threadId, event.turnId);
    const now = this.now();
    if (held.setAt !== undefined && now - held.setAt < MODEL_HOLD_MS) return;
    const found = derivedLabel(event, this.options.language?.(event.threadId), held.site);
    if (!found) return;
    if (found.site) held.site = found.site;
    clearTimeout(held.timer);
    held.timer = undefined;
    const show = () => {
      held.timer = undefined;
      if (this.derived.get(event.threadId) !== held || this.labels.get(event.threadId)?.label === found.label) return;
      held.shownAt = this.now();
      this.labels.set(event.threadId, { turnId: event.turnId, label: found.label });
      this.options.emit!({
        eventId: newId(), provider: event.provider, providerInstanceId: event.providerInstanceId, threadId: event.threadId,
        createdAt: new Date(held.shownAt).toISOString(), turnId: event.turnId, type: "turn.progress", activity: "tool", tool: STATUS_TOOL, label: found.label,
      });
    };
    const wait = held.shownAt + LABEL_HOLD_MS - now;
    if (wait <= 0) return show();
    held.timer = setTimeout(show, wait);
    held.timer.unref?.();
  }

  private derivedFor(threadId: string, turnId: string | undefined): Derived {
    let held = this.derived.get(threadId);
    if (!held || (turnId && held.turnId && held.turnId !== turnId)) {
      if (held) clearTimeout(held.timer);
      held = { turnId, shownAt: -Infinity };
      this.derived.set(threadId, held);
    }
    return held;
  }

  /** The sound the bot chose for the notice of the thread's latest turn. It outlives the turn's end, which is when that
   * notice goes, and is dropped when the thread's next turn starts. */
  notificationSound(threadId: string): NotificationSound | undefined {
    return this.sounds.get(threadId);
  }

  /** A new turn starts on the thread: the last turn's choice of sound no longer applies. */
  turnStarted(threadId: string): void {
    this.sounds.delete(threadId);
  }

  forget(threadId: string): void {
    this.labels.delete(threadId);
    this.calls.delete(threadId);
    clearTimeout(this.derived.get(threadId)?.timer);
    this.derived.delete(threadId);
  }
}
