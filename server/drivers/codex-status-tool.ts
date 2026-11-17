// set_status, send_message and set_notification_sound as Codex dynamic tools. Codex keeps MCP tools behind its tool_search until the model looks
// them up, so the agents server's copies were never in reach; a dynamic tool given at thread/start is sent with every request
// (codex-cli 0.167.0 app-server, `dynamicTools` with `deferLoading: false`), persists with the thread, and is answered
// here through `item/tool/call`. The harness reads the label or the message from the call's item.
import { STATUS_TOOL } from "../../shared/turn-progress.ts";
import { callSendMessageTool, SEND_MESSAGE_TOOL, SEND_MESSAGE_TOOL_DEFINITION } from "./agents-send-message-tool.ts";
import { callNotificationSoundTool, NOTIFICATION_SOUND_TOOL, NOTIFICATION_SOUND_TOOL_DEFINITION } from "./agents-sound-tool.ts";
import { STATUS_TOOL_DEFINITION } from "./agents-status-tool.ts";
import { parseVersionTriple, versionAtLeast, type VersionTriple } from "./acp/version-probe.ts";

export const DYNAMIC_TOOLS_MIN_CODEX: VersionTriple = [0, 167, 0];

/** thread/start's dynamicTools for this Codex, or nothing on one too old to take them. */
export function codexStatusThreadParams(version: string | null): { dynamicTools?: unknown[] } {
  const parsed = version === null ? null : parseVersionTriple(version);
  if (parsed === null || !versionAtLeast(parsed, DYNAMIC_TOOLS_MIN_CODEX)) return {};
  return {
    dynamicTools: [STATUS_TOOL_DEFINITION, SEND_MESSAGE_TOOL_DEFINITION, NOTIFICATION_SOUND_TOOL_DEFINITION].map((tool) => ({
      type: "function", name: tool.name, description: tool.description, inputSchema: tool.inputSchema, deferLoading: false,
    })),
  };
}

/** The JSON-RPC reply to an `item/tool/call`: set_status, send_message and set_notification_sound only answer; any other dynamic tool is not ours. */
export function codexDynamicToolReply(params: { tool?: unknown; namespace?: unknown }): { result: unknown } | { error: { code: number; message: string } } {
  const answer = params.namespace ? undefined : params.tool === STATUS_TOOL ? "ok" : params.tool === SEND_MESSAGE_TOOL ? callSendMessageTool().text
    : params.tool === NOTIFICATION_SOUND_TOOL ? callNotificationSoundTool().text : undefined;
  if (answer) return { result: { contentItems: [{ type: "inputText", text: answer }], success: true } };
  return { error: { code: -32601, message: `Unknown dynamic tool: ${String(params.tool)}` } };
}
