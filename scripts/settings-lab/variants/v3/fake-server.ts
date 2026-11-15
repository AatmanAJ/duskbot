// the app's /api, answered in memory: the real settings panes run against this instead of a harness. nothing leaves
// the page; an endpoint without a fake answers 404 and is listed in window.__v3Missing for the next pass.
import { FAKE_CONFIG, FAKE_INSTANCES, fakeRoutes } from "./fake-data";

type Json = Record<string, unknown> | unknown[] | null;
export type Route = { method: string; path: RegExp; answer: (match: RegExpMatchArray, body: any, url: URL) => Json | Response };

const missing = new Set<string>();

export const server = {
  config: structuredClone(FAKE_CONFIG),
  instances: structuredClone(FAKE_INSTANCES),
  listeners: new Set<() => void>(),
  changed() { for (const listen of server.listeners) listen(); },
};

const json = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function answer(url: URL, init: RequestInit | undefined, request: Request | null): Promise<Response> {
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  let body: unknown = undefined;
  const raw = init?.body ?? (request && method !== "GET" ? await request.clone().text() : undefined);
  if (typeof raw === "string" && raw) { try { body = JSON.parse(raw); } catch { body = raw; } }
  for (const route of fakeRoutes(server)) {
    if (route.method !== "*" && route.method !== method) continue;
    const match = url.pathname.match(route.path);
    if (!match) continue;
    const result = route.answer(match, body, url);
    // a beat of latency so spinners and pending states show the way they do in the app
    await new Promise((resolve) => setTimeout(resolve, method === "GET" ? 60 : 220));
    return result instanceof Response ? result : json(result);
  }
  missing.add(`${method} ${url.pathname}`);
  console.info("[v3 fake api] no fake for", method, url.pathname);
  (window as unknown as { __v3Missing: string[] }).__v3Missing = [...missing];
  return json({ error: "Not in the settings lab" }, 404);
}

const fakeFetch: typeof fetch = (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), location.href);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return answer(url, init, request);
  return below(input, init);
};
let below: typeof fetch = window.fetch.bind(window);

/** while v3 is on screen every same-origin /api request goes to these fakes, on top of whatever fetch other lab
 * variants installed; everything else (vite, fonts, images) passes through. returns the release. */
export function claimFetch(): () => void {
  if (window.fetch !== fakeFetch) {
    below = window.fetch;
    window.fetch = fakeFetch;
  }
  return () => {
    if (window.fetch === fakeFetch) window.fetch = below;
  };
}

// live streams have no fake: they stay closed rather than reach anything
const RealEventSource = window.EventSource;
window.EventSource = class extends RealEventSource {
  constructor(href: string | URL, options?: EventSourceInit) {
    const url = new URL(String(href), location.href);
    super(url.origin === location.origin && url.pathname.startsWith("/api/") ? "data:text/event-stream," : href, options);
  }
} as typeof EventSource;
