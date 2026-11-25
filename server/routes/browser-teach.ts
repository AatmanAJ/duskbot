import { TeachError } from "../browser/teach.ts";
import type { BrowserViewerRouteDeps } from "./browser-viewers.ts";
import type { RouteHandler } from "./table.ts";

export const TEACH_PATH = /^\/api\/bots\/([\w-]+)\/browser\/teach$/;

type RouteArgs = Pick<Parameters<RouteHandler>[0], "req" | "res" | "url" | "method" | "auth" | "json" | "readBody">;

/** The person's recording of a task in a bot's browser: GET reads it; POST starts, stops or discards it. */
export async function teachRoute(deps: BrowserViewerRouteDeps, botId: string, { req, res, url, method, auth, json, readBody }: RouteArgs) {
  res.setHeader("cache-control", "no-store");
  if (method !== "GET" && method !== "POST") return json(res, 405, { error: "method not allowed" });
  const audience = deps.audience(auth, url.searchParams.get("threadId"));
  if (!audience) return json(res, 404, { error: "no such conversation" });
  const browser = await deps.browser(botId, audience);
  if ("error" in browser) return json(res, browser.status, { error: browser.error });
  const failure = await deps.authorize(req, auth);
  if (failure) return json(res, failure.status, { error: failure.error });
  const recorders = deps.viewers.teach;
  const person = deps.person(auth);
  if (method === "GET") return json(res, 200, recorders.status(browser.session, person));
  const body = await readBody(req, 1_024);
  try {
    switch (body?.action) {
      case "start": return json(res, 200, recorders.start(browser.session, person));
      case "stop": return json(res, 200, recorders.stop(browser.session, person));
      case "discard":
        recorders.discard(browser.session, person);
        return json(res, 200, recorders.status(browser.session, person));
      default: return json(res, 400, { error: "Say start, stop or discard." });
    }
  } catch (error) {
    if (error instanceof TeachError) return json(res, error.status, { error: error.message });
    throw error;
  }
}
