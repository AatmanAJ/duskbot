import { afterEach, describe, expect, it } from "vitest";

import { BrowserRuntime, type BrowserSpawnSpec } from "./browser-runtime.ts";

// agent-browser 0.37.0 as seen against real sites: tab_new answers before the tab has left about:blank, and an open the
// site answers 4xx/5xx fails with net::ERR_HTTP_RESPONSE_CODE_FAILURE although the page it sent is showing.
const FAKE = `
const lines = require('node:readline').createInterface({ input: process.stdin });
let url = 'about:blank';
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
const text = (value, isError) => ({ content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) });
lines.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === 'initialize') return send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} } });
  if (m.method === 'tools/list') return send(m.id, { tools: [] });
  const { name, arguments: args } = m.params;
  if (name === 'agent_browser_tab_new') { setTimeout(() => { url = args.url; }, 400); return send(m.id, text(args.url)); }
  if (name === 'agent_browser_get_url') return send(m.id, text(url));
  if (name === 'agent_browser_open' && args.url === 'https://walled.test/') { url = args.url; return send(m.id, text('Navigation failed: net::ERR_HTTP_RESPONSE_CODE_FAILURE', true)); }
  if (name === 'agent_browser_open') { url = args.url; return send(m.id, text('Opened')); }
  if (name === 'agent_browser_snapshot') return send(m.id, text(url === 'about:blank' ? '' : '- heading "' + url + '" [ref=e1]'));
  if (name === 'agent_browser_eval') return send(m.id, text('eval unavailable', true));
  send(m.id, text(JSON.stringify(m.params)));
});
`;
const spec = (): BrowserSpawnSpec => ({ command: process.execPath, args: ["-e", FAKE], env: { PATH: process.env.PATH } });
const runtimes: BrowserRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map((value) => value.closeAll())); });
const said = (result: unknown) => ((result as { content?: Array<{ text?: string }> }).content ?? []).map((part) => part.text ?? "").join("\n");

describe("a page a bot opens", () => {
  it("in a new tab answers once the tab shows it, so the next read is not of a blank tab", async () => {
    const runtime = new BrowserRuntime({ requestTimeoutMs: 5_000 });
    runtimes.push(runtime);
    const engine = spec();
    const opened = await runtime.agentRpc("tabs", engine, "tools/call", { name: "agent_browser_tab_new", arguments: { url: "https://second.test/" } });
    expect((opened as { isError?: boolean }).isError).not.toBe(true);
    expect(said(opened)).toContain('heading "https://second.test/"');
    expect(said(await runtime.agentRpc("tabs", engine, "tools/call", { name: "agent_browser_get_url", arguments: {} }))).toBe("https://second.test/");
  });

  it("that answered with an error status shows the bot what the site sent instead of a failed navigation", async () => {
    const runtime = new BrowserRuntime({ requestTimeoutMs: 5_000 });
    runtimes.push(runtime);
    const opened = await runtime.agentRpc("walled", spec(), "tools/call", { name: "agent_browser_open", arguments: { url: "https://walled.test/" } });
    expect((opened as { isError?: boolean }).isError).not.toBe(true);
    expect(said(opened)).toMatch(/answered with an error status/);
    expect(said(opened)).toContain('heading "https://walled.test/"');
    expect(said(opened)).not.toMatch(/ERR_HTTP_RESPONSE_CODE_FAILURE/);
  });
});
