// GET /api/site-icon?domain=example.com: the site's own icon as a 96px PNG (server/site-icons.ts), 404 when it has none.
// GET /api/site-icon?app=gmail: the app's Composio logo, drawn the same way.
import { join } from "node:path";

import { DATA_DIR } from "../config.ts";
import { createSiteIcons, normalizeAppSlug, normalizeSiteDomain, type SiteIcons } from "../site-icons.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createSiteIconRoutes(icons: SiteIcons): RouteHandler {
  return async ({ res, url, path, method, json }) => {
    if (path !== "/api/site-icon" || method !== "GET") return PASS;
    const app = url.searchParams.has("app") ? normalizeAppSlug(url.searchParams.get("app")) : undefined;
    const domain = app === undefined ? normalizeSiteDomain(url.searchParams.get("domain")) : null;
    if (app === null) return json(res, 400, { error: "app must be an app's id such as gmail" });
    if (!app && !domain) return json(res, 400, { error: "domain must be a site name such as example.com" });
    const icon = app ? await icons.app(app) : await icons.get(domain);
    if (!icon) {
      res.setHeader("cache-control", "private, max-age=3600");
      return json(res, 404, { error: "no icon" });
    }
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(icon.length),
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
    });
    res.end(icon);
  };
}

let shared: RouteHandler | null = null;
/** The table's entry: the cache sits in the data folder, made on the first request. */
export const siteIconRoutes: RouteHandler = (ctx) => {
  shared ??= createSiteIconRoutes(createSiteIcons({ dir: join(DATA_DIR, "site-icons") }));
  return shared(ctx);
};
