// MCP's Streamable HTTP transport for the host's mounts, on the harness's own loopback listener: no new port and no
// firewall prompt. A tool call still running after a moment answers as an event stream with a keep-alive comment every
// few seconds, since an approval or a question waits on the person for as long as they take and an HTTP client's idle
// timer would otherwise fire; a quick one answers as plain JSON.
import type { IncomingMessage, ServerResponse } from "node:http";

import { MAX_INPUT_BYTES } from "../harness-mcp-request.ts";
import { PASS, type RouteContext, type RouteHandler } from "../routes/table.ts";
import { MCP_HOST_PATH, mcpHost, mountIdentity, type McpHost } from "./host.ts";
import { MOUNT_NAME } from "./mounts.ts";

type Json = Record<string, unknown>;

function bearer(req: IncomingMessage): string | null {
  return /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? null;
}

function refuse(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify({ error: message }));
}

function acceptsEvents(req: IncomingMessage): boolean {
  return /\btext\/event-stream\b/.test(req.headers.accept ?? "");
}

export function createMcpHostRoutes(host: McpHost, options: { keepAliveMs?: number; streamAfterMs?: number } = {}): RouteHandler {
  return async ({ req, res, path, method, readBody }: RouteContext) => {
    if (!path.startsWith(MCP_HOST_PATH)) return PASS;
    const name = path.slice(MCP_HOST_PATH.length);
    const token = bearer(req);
    // One answer for a missing, unknown, revoked or other server's bearer: a caller learns nothing about which mounts exist.
    const mount = token && MOUNT_NAME.test(name) ? host.registry.resolve(token, name) : null;
    if (!mount) return refuse(res, 401, "unauthorized");
    for (const [header, value] of Object.entries(mountIdentity(mount))) {
      const claimed = req.headers[header];
      if (claimed !== undefined && claimed !== value) return refuse(res, 401, "unauthorized");
    }
    if (method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }
    // No server-initiated stream and no session to end: a client falls back to request and response.
    if (method !== "POST") {
      res.writeHead(405, { allow: "POST, DELETE" });
      res.end();
      return;
    }
    const body = await readBody(req, MAX_INPUT_BYTES) as unknown;
    const batch = Array.isArray(body);
    const frames = (batch ? body : [body]) as unknown[];
    if (!frames.length || !frames.every((frame) => frame && typeof frame === "object" && !Array.isArray(frame))) {
      return refuse(res, 400, "expected a JSON-RPC message");
    }
    const stop = new AbortController();
    res.on("close", () => { if (!res.writableFinished) stop.abort(); });
    const answer = host.answer(mount);
    const replies = Promise.all((frames as Json[]).map((frame) => answer(frame, stop.signal)))
      .then((all) => all.filter((reply) => reply !== undefined));
    const settled = replies.then(() => true);
    const streams = acceptsEvents(req) && (frames as Json[]).some((frame) => frame.method === "tools/call")
      && !(await Promise.race([settled, new Promise<false>((resolve) => setTimeout(() => resolve(false), options.streamAfterMs ?? host.streamAfterMs).unref?.())]));
    if (!streams) {
      const answered = await replies;
      if (!answered.length) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(batch ? answered : answered[0]));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write(": keep-alive\n\n");
    const alive = setInterval(() => { if (!res.writableEnded) res.write(": keep-alive\n\n"); }, options.keepAliveMs ?? host.keepAliveMs);
    try {
      for (const reply of await replies) res.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
    } finally {
      clearInterval(alive);
      res.end();
    }
  };
}

export const mcpHostRoutes = createMcpHostRoutes(mcpHost);
