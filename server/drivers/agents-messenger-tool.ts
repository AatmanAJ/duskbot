import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const MESSENGER_TOOL = "messaging_channels";
export const MESSENGER_TOOL_PATH = "/api/internal/messengers";

export async function callMessengerTool(_name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse(MESSENGER_TOOL_PATH, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: String(body.text ?? "Done.") } : { text: String(body.error ?? "That didn't work. Try again shortly."), isError: true };
}

export const MESSENGER_TOOL_DEFINITION = {
  name: MESSENGER_TOOL,
  description: "This bot's own Telegram and Discord bots, so people message you there and you answer as yourself. status: what is connected, who is let in, who was turned away. connect: link the bot token the person pasted in this chat (leave token out; it is read from their message). allow / remove_access: a person or group by name from the turned-away list, or by id. disconnect: stop answering there.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["status", "connect", "allow", "remove_access", "disconnect"] },
      platform: { type: "string", enum: ["telegram", "discord"] },
      who: { type: "string", maxLength: 200, description: "allow / remove_access: a name from status, or a numeric id." },
    },
    required: ["action"],
  },
};
