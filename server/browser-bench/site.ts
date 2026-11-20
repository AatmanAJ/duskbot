// The benchmark's local web site: every run gets its own path prefix (/r/<run>/), so runs in parallel never share
// state, and pages report what the bot did to /r/<run>/api/event. It answers on 127.0.0.1 and on localhost, two sites,
// so a frame from the other one runs out of process, as a real embedded form or payment field does.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface BenchEvent { type: string; at: number; [key: string]: unknown }

export interface Reply {
  body?: string | Buffer;
  type?: string;
  status?: number;
  headers?: Record<string, string>;
  delayMs?: number;
}

export interface RequestContext {
  method: string;
  /** The path after /r/<run>/, such as "orders/4471". */
  path: string;
  query: URLSearchParams;
  body: string;
  cookies: Record<string, string>;
  /** http://127.0.0.1:<port>/r/<run>/ */
  base: string;
  /** The same run on the other site: http://localhost:<port>/r/<run>/ */
  cross: string;
  run: Run;
}

export type Route = (request: RequestContext) => Reply;

export interface Run {
  id: string;
  taskId: string;
  events: BenchEvent[];
  /** Every path the run's pages asked for, in order. */
  requests: string[];
  /** Free state a task's routes keep for the run. */
  state: Record<string, unknown>;
}

export interface SiteTask {
  id: string;
  routes: Record<string, Route>;
}

export class BenchSite {
  readonly #servers: Server[] = [];
  readonly #runs = new Map<string, Run>();
  readonly #tasks = new Map<string, SiteTask>();
  port = 0;

  static async start(tasks: readonly SiteTask[]): Promise<BenchSite> {
    const site = new BenchSite();
    for (const task of tasks) site.#tasks.set(task.id, task);
    const first = createServer((request, response) => site.#handle(request, response));
    await new Promise<void>((resolve) => first.listen(0, "127.0.0.1", resolve));
    site.port = (first.address() as AddressInfo).port;
    site.#servers.push(first);
    const second = createServer((request, response) => site.#handle(request, response));
    await new Promise<void>((resolve) => { second.once("error", () => resolve()); second.listen(site.port, "::1", () => resolve()); });
    if (second.listening) site.#servers.push(second);
    return site;
  }

  newRun(taskId: string): Run {
    const run: Run = { id: randomUUID().slice(0, 8), taskId, events: [], requests: [], state: {} };
    this.#runs.set(run.id, run);
    return run;
  }

  base(run: Run): string {
    return `http://127.0.0.1:${this.port}/r/${run.id}/`;
  }

  cross(run: Run): string {
    return `http://localhost:${this.port}/r/${run.id}/`;
  }

  #handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const match = /^\/r\/([a-z0-9-]+)\/(.*)$/u.exec(url.pathname);
    const run = match ? this.#runs.get(match[1]!) : undefined;
    const task = run ? this.#tasks.get(run.taskId) : undefined;
    if (!run || !task || !match) { response.writeHead(404, { "content-type": "text/plain" }); response.end("not here"); return; }
    const path = match[2]!;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      run.requests.push(`${request.method} ${path}${url.search}`);
      if (path === "api/event" && request.method === "POST") {
        try { run.events.push({ ...(JSON.parse(body) as Record<string, unknown>), at: Date.now() } as BenchEvent); } catch {}
        response.writeHead(204, { "access-control-allow-origin": "*" });
        response.end();
        return;
      }
      const cookies = Object.fromEntries((request.headers.cookie ?? "").split(/;\s*/u).filter(Boolean).map((pair) => {
        const at = pair.indexOf("=");
        return [pair.slice(0, at), decodeURIComponent(pair.slice(at + 1))];
      }));
      const route = task.routes[path] ?? task.routes[path.replace(/\/[^/]*$/u, "/*")];
      if (!route) { response.writeHead(404, { "content-type": "text/plain" }); response.end("not here"); return; }
      const base = `http://127.0.0.1:${this.port}/r/${run.id}/`;
      const cross = `http://localhost:${this.port}/r/${run.id}/`;
      let reply: Reply;
      try {
        reply = route({ method: request.method ?? "GET", path, query: url.searchParams, body, cookies, base, cross, run });
      } catch (error) {
        reply = { status: 500, type: "text/plain", body: String(error) };
      }
      const send = () => {
        response.writeHead(reply.status ?? 200, { "content-type": reply.type ?? "text/html; charset=utf-8", "cache-control": "no-store", ...reply.headers });
        response.end(reply.body ?? "");
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.#servers.map((server) => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); })));
  }
}

/** Reports what the bot did, from any page of the run, the other site's included. */
export const REPORT_JS = `const RUN_BASE = location.pathname.split("/").slice(0, 3).join("/") + "/";
function report(type, data) { return fetch(RUN_BASE + "api/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...(data || {}) }), keepalive: true }); }`;

/** A page with the run's report() and a plain, app-like look. */
export function page(title: string, body: string, { style = "", script = "", head = "" }: { style?: string; script?: string; head?: string } = {}): Reply {
  return {
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>*{box-sizing:border-box}body{font:14px/1.4 system-ui,-apple-system,sans-serif;margin:0;color:#1d1d1f;background:#fff}button{font:inherit}${style}</style>${head}
<script>${REPORT_JS}</script></head><body>${body}<script>${script}</script></body></html>`,
  };
}

export const json = (value: unknown, delayMs = 0): Reply => ({ body: JSON.stringify(value), type: "application/json", ...(delayMs ? { delayMs } : {}) });
export const redirect = (location: string, headers: Record<string, string> = {}): Reply => ({ status: 302, headers: { location, ...headers }, body: "" });

/** A small seeded random, so generated lists are the same on every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1_664_525 + 1_013_904_223) >>> 0; return state / 2 ** 32; };
}
