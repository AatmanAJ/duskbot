// The agents catalog's set_notification_sound tool: whether the notice for this turn's reply makes a sound. The harness reads
// the choice from the engine's report of the call (server/harness/status-calls.ts), so the call itself only answers.
import type { NotificationSound } from "../../shared/notification.ts";
import type { ToolCallResult } from "./agents-call.ts";

export const NOTIFICATION_SOUND_TOOL = "set_notification_sound";
export const NOTIFICATION_SOUNDS: readonly NotificationSound[] = ["quiet", "ding"];

export function isNotificationSound(value: unknown): value is NotificationSound {
  return NOTIFICATION_SOUNDS.includes(value as NotificationSound);
}

export function callNotificationSoundTool(): ToolCallResult {
  return { text: "ok" };
}

export const NOTIFICATION_SOUND_TOOL_DEFINITION = {
  name: NOTIFICATION_SOUND_TOOL,
  description:
    "Whether the person's notice for this turn's reply makes a sound; it shows either way. quiet: a receipt, a routine's \"done\", a status line nobody has to act on. ding: it needs them (a decision, a blocker) or is the result they asked to hear about. Without it a reply to the person dings and a routine or webhook run stays quiet; questions and approvals always ding. Call it once, with your last tool calls. Never mention it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sound: { type: "string", enum: [...NOTIFICATION_SOUNDS] },
    },
    required: ["sound"],
  },
};
