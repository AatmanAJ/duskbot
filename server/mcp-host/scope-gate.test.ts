import { describe, expect, it } from "vitest";

import { EXCLUDED_TOOL, scopeGate } from "./scope-gate.ts";

const tools = ["list_bots", "create_bot", "memory_update"].map((name) => ({ name, inputSchema: { type: "object" } }));

function upstream() {
  const calls: unknown[] = [];
  const answer = async (frame: Record<string, unknown>) => {
    calls.push(frame);
    if (frame.method === "tools/list") return { jsonrpc: "2.0", id: frame.id, result: { tools } };
    if (frame.method === "tools/call") return { jsonrpc: "2.0", id: frame.id, result: { content: [{ type: "text", text: "done" }], isError: true } };
    return { jsonrpc: "2.0", id: frame.id, result: {} };
  };
  return { calls, answer };
}

describe("the MCP host's tool selection", () => {
  it("lists and runs only what the selection allows, and never forwards a refused call", async () => {
    const inner = upstream();
    const gate = scopeGate("agents", { allow: ["mcp:agents:list_bots"] }, inner.answer);
    const listed = await gate({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(["list_bots"]);
    const refused = await gate({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_bot", arguments: { name: "x" } } });
    expect(refused).toEqual({ jsonrpc: "2.0", id: 2, error: { code: -32602, message: EXCLUDED_TOOL } });
    expect(inner.calls.filter((frame) => (frame as { method: string }).method === "tools/call")).toEqual([]);
    const ran = await gate({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_bots", arguments: {} } }) as { result: { content: Array<{ text: string }> } };
    expect(ran.result.content[0]!.text).toContain("done");
  });

  it("honours a deny over an allow, and judges an action tool by its arguments", async () => {
    const inner = upstream();
    const gate = scopeGate("agents", { allow: ["mcp:agents:*"], deny: ["mcp:agents:create_bot"] }, inner.answer);
    const listed = await gate({ jsonrpc: "2.0", id: 1, method: "tools/list" }) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(["list_bots", "memory_update"]);
    expect(await gate({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_bot" } })).toMatchObject({ error: { message: EXCLUDED_TOOL } });
  });

  it("refuses frames a restricted connection can't judge", async () => {
    const gate = scopeGate("data", { allow: ["mcp:data:*"] }, upstream().answer);
    expect(await gate({ id: 1, method: "tools/list" })).toMatchObject({ error: { code: -32600 } });
    expect(await gate({ jsonrpc: "2.0", method: "tools/list" })).toMatchObject({ error: { code: -32600 } });
    expect(await gate({ jsonrpc: "2.0", method: "tools/call", params: { name: "x" } })).toMatchObject({ error: { code: -32602 } });
    expect(await gate({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x", arguments: [] } })).toMatchObject({ error: { code: -32602 } });
    expect(await gate({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {} })).toMatchObject({ error: { code: -32602 } });
  });

  it("refuses a catalog it can't filter", async () => {
    const gate = scopeGate("data", { allow: ["mcp:data:*"] }, async (frame) => ({ jsonrpc: "2.0", id: frame.id, result: { tools: [{ description: "no name" }] } }));
    expect(await gate({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toMatchObject({ error: { code: -32603 } });
  });
});
