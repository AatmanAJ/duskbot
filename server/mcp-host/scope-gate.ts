// A bot's tool selection over one of dusk bot's own MCP servers answered in this process: the rules mcp-gate.ts applies
// to a relay, without a gate process per server.
import { allowsTool, type ToolScope } from "../../shared/tool-scope.ts";
import { withNextStepResult } from "../tool-next-step.ts";

type Json = Record<string, unknown>;
export type Answer = (frame: Json, signal?: AbortSignal) => Promise<unknown>;

const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export const EXCLUDED_TOOL = "Tool selection excludes this tool. Check the bot's Access settings.";

export function scopeGate(name: string, scope: ToolScope, inner: Answer): Answer {
  return async (frame, signal) => {
    if (frame.jsonrpc !== "2.0") return rpcError(frame.id, -32600, "Invalid JSON-RPC frame");
    const params = isRecord(frame.params) ? frame.params : undefined;
    const hasId = typeof frame.id === "string" || (typeof frame.id === "number" && Number.isFinite(frame.id));
    if (frame.method === "tools/call") {
      if (!hasId || typeof params?.name !== "string" || (params.arguments !== undefined && !isRecord(params.arguments))) {
        return rpcError(frame.id, -32602, "Invalid tool call");
      }
      if (!allowsTool(scope, { kind: "mcp", server: name, name: params.name }, params.arguments ?? {})) {
        return rpcError(frame.id, -32602, EXCLUDED_TOOL);
      }
      const reply = await inner(frame, signal) as Json | undefined;
      return reply && isRecord(reply) && Object.hasOwn(reply, "result") ? { ...reply, result: withNextStepResult(reply.result) } : reply;
    }
    if (frame.method === "tools/list") {
      if (!hasId) return rpcError(frame.id, -32600, "Tool listing needs a request ID");
      const reply = await inner(frame, signal) as Json | undefined;
      if (!reply || !isRecord(reply) || reply.error !== undefined) return reply;
      const result = reply.result;
      if (!isRecord(result) || !Array.isArray(result.tools)
        || !result.tools.every((tool) => isRecord(tool) && typeof tool.name === "string" && tool.name.trim().length > 0)
        || (result.nextCursor !== undefined && typeof result.nextCursor !== "string")) {
        return rpcError(frame.id, -32603, "Invalid tool catalog on a restricted connection");
      }
      return { ...reply, result: { ...result, tools: result.tools.filter((tool) => allowsTool(scope, { kind: "mcp", server: name, name: (tool as Json).name as string })) } };
    }
    return inner(frame, signal);
  };
}
