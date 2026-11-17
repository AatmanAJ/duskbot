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
    "How the person's notice of this turn's reply sounds; it shows either way. quiet: a receipt, a \"done\", a status nobody acts on. ding: it needs them or is a result they asked for. Unset, a reply to them dings and an unattended run stays quiet. Never mention it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sound: { type: "string", enum: [...NOTIFICATION_SOUNDS] },
    },
    required: ["sound"],
  },
};
