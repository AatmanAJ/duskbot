import { describe, expect, it } from "vitest";

import { parseWorkspaceReport } from "../shared/dashboard-protocol.ts";
import { connectedInApp, dashboardApps, type AppsSource } from "./dashboard-apps.ts";

const noComposio: AppsSource = { connectorAvailability: () => "missing", connectedServicesInventory: async () => ({ services: {}, complete: true }) } as unknown as AppsSource;
const withComposio = (services: Record<string, { connected: boolean; pending: boolean }>): AppsSource =>
  ({ connectorAvailability: () => "configured", connectedServicesInventory: async () => ({ services, complete: true }) }) as unknown as AppsSource;

describe("the apps report", () => {
  it("lists apps connected in the app: MCP servers once per app, a sign-in still owed as pending, a Gmail mailbox", () => {
    expect(connectedInApp([
      { name: "linear", enabled: true, url: "https://mcp.linear.app/mcp", auth: "signed-in" },
      { name: "linear-2", enabled: true, url: "https://mcp.linear.app/mcp", auth: "needs-sign-in" },
      { name: "notion", enabled: true, url: "https://mcp.notion.com/mcp", auth: "needs-sign-in" },
      { name: "warehouse", enabled: true },
      { name: "off", enabled: false, url: "https://off.example.com/mcp" },
      { name: "own", enabled: true, url: "https://bot.example.com/mcp", bot: "bot-1" },
      { name: "composio", enabled: true, url: "https://connect.composio.dev/mcp" },
    ], ["me@example.com", "Me@Gmail.com"])).toEqual([
      { slug: "linear", connected: true, pending: false, via: "app" },
      { slug: "notion", connected: false, pending: true, via: "app" },
      { slug: "warehouse", connected: true, pending: false, via: "app" },
      { slug: "gmail", connected: true, pending: false, via: "app" },
    ]);
    expect(connectedInApp([], ["me@example.com"])).toEqual([]);
  });

  it("reports apps connected in the app on a computer without Composio, so the website is not empty", async () => {
    const inApp = () => connectedInApp([{ name: "github", enabled: true, url: "https://api.githubcopilot.com/mcp/", auth: "signed-in" }]);
    expect(await dashboardApps({} as never, noComposio, undefined, inApp))
      .toEqual({ available: false, complete: true, services: [{ slug: "github", connected: true, pending: false, via: "app" }] });
    expect(await dashboardApps({} as never, noComposio)).toEqual({ available: false, complete: true, services: [] });
  });

  it("puts Composio's apps first and leaves out an app it already has", async () => {
    const inApp = () => [{ slug: "slack", connected: true, pending: false, via: "app" as const }, { slug: "linear", connected: true, pending: false, via: "app" as const }];
    const report = await dashboardApps({} as never, withComposio({ slack: { connected: true, pending: false } }), undefined, inApp);
    expect(report.services).toEqual([{ slug: "slack", connected: true, pending: false }, { slug: "linear", connected: true, pending: false, via: "app" }]);
    expect(await dashboardApps({} as never, withComposio({}), undefined, () => { throw new Error("config unreadable"); }))
      .toEqual({ available: true, complete: true, services: [] });
  });

  it("keeps `via` through the report parser and refuses an unknown one", () => {
    const base = { v: 1, seq: 1, at: 1, workspace: { name: "Mac", kind: "mac", version: "1", platform: "darwin" } };
    const parsed = parseWorkspaceReport({ ...base, apps: { available: false, complete: true, services: [{ slug: "linear", connected: true, pending: false, via: "app" }, { slug: "gmail", connected: true, pending: false }] } });
    expect(parsed?.apps?.services.map((service) => service.via)).toEqual(["app", undefined]);
    expect(parseWorkspaceReport({ ...base, apps: { available: false, complete: true, services: [{ slug: "linear", connected: true, pending: false, via: "nope" }] } })?.apps).toBeUndefined();
  });
});
