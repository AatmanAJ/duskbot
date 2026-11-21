import type { DashApp } from "./connectors.ts";

export type ConnectorType = "Connector" | "MCP";
export type ConnectorStatus = "ready" | "needs-auth";
export interface ConnectorRow {
  id: string;
  app: DashApp | null;
  label: string;
  type: ConnectorType;
  category: string;
  status: ConnectorStatus;
  tools: number | null;
  permissions: "Ask first" | "Allowed" | null;
  workspaces: Array<{ id: string; name: string }>;
  /** the workspaces where it still needs sign-in */
  needsAuth: Array<{ id: string; name: string }>;
}
export interface ConnectorExtras {
  [appIdLowercase: string]: { status?: ConnectorStatus; tools?: number; permissions?: "Ask first" | "Allowed" };
}

export const CATEGORY_NAMES = {
  credentials: "Password Managers", productivity: "Productivity", communication: "Communication", design: "Design",
  code: "Code", data: "Data", sales: "Sales", marketing: "Marketing", finance: "Finance", research: "Research",
  support: "Support", ai: "AI", other: "Other",
};

const POPULAR = ["gmail", "googlecalendar", "googledrive", "slack", "github", "notion", "googledocs", "googlesheets", "outlook", "linear", "figma", "zoom", "dropbox", "jira", "hubspot", "asana", "trello", "discord", "bitwarden", "lastpass", "dashlane"];
const idsOf = (app: DashApp) => [app.id, ...(app.aliases ?? []), ...(app.composio ? [app.composio] : []), ...(app.remote ? [app.remote] : [])].map((id) => id.toLowerCase());
const popularity = (row: ConnectorRow) => Math.min(...(row.app ? idsOf(row.app) : [row.id.toLowerCase()]).map((id) => POPULAR.indexOf(id)).filter((index) => index >= 0));

export const FIXTURE_EXTRAS: ConnectorExtras = {
  notion: { tools: 12, permissions: "Allowed" },
  github: { tools: 26, permissions: "Ask first" },
  slack: { tools: 9, permissions: "Allowed" },
  gmail: { tools: 14, permissions: "Ask first" },
  googlecalendar: { tools: 7, permissions: "Allowed" },
  linear: { status: "needs-auth", tools: 0 },
  figma: { status: "needs-auth" },
};

/** whether the workspace has this app (by any of `ids`) connected in the app itself, so only that app can change it */
export function connectedInAppOn(inApp: Record<string, string[]>, workspaceId: string, ids: ReadonlyArray<string | null | undefined>): boolean {
  const there = new Set((inApp[workspaceId] ?? []).map((id) => id.toLowerCase()));
  return ids.some((id) => typeof id === "string" && there.has(id.toLowerCase()));
}

/** shows an app whose sign-in was started and not finished as needing sign-in on that workspace, next to the connected ones */
export function withPending(connections: Record<string, string[]>, pending: Record<string, string[]>, base: ConnectorExtras = {}): { connections: Record<string, string[]>; extras: ConnectorExtras; pending: Record<string, string[]> } {
  // oxlint-disable-next-line no-unused-vars -- status is dropped from the rest
  const extras: ConnectorExtras = Object.fromEntries(Object.entries(base).map(([id, { status: _, ...rest }]) => [id, rest]));
  const merged: Record<string, string[]> = { ...connections };
  const waiting: Record<string, string[]> = {};
  for (const [workspace, slugs] of Object.entries(pending)) for (const slug of slugs) {
    const connected = (connections[workspace] ?? []).some((id) => id.toLowerCase() === slug.toLowerCase());
    if (connected) continue;
    merged[workspace] = [...(merged[workspace] ?? []), slug];
    waiting[workspace] = [...(waiting[workspace] ?? []), slug.toLowerCase()];
  }
  return { connections: merged, extras, pending: waiting };
}

export function connectorRows(apps: DashApp[], connections: Record<string, string[]>, workspaces: Array<{ id: string; name: string }>, extra: ConnectorExtras = {}, pending: Record<string, string[]> = {}): ConnectorRow[] {
  const connected = workspaces.map((workspace) => ({ workspace, ids: new Set((connections[workspace.id] ?? []).map((id) => id.toLowerCase())), waiting: new Set((pending[workspace.id] ?? []).map((id) => id.toLowerCase())) }));
  const known = new Set(apps.flatMap(idsOf));
  const rows: ConnectorRow[] = [];
  const add = (id: string, app: DashApp | null, ids: string[]) => {
    const entries = connected.filter((entry) => ids.some((alias) => entry.ids.has(alias)));
    if (!entries.length) return;
    const linked = entries.map(({ workspace }) => ({ id: workspace.id, name: workspace.name }));
    const extras = extra[id.toLowerCase()] ?? ids.map((alias) => extra[alias]).find((value) => value !== undefined);
    const needsAuth = extras?.status === "needs-auth" ? linked : entries.filter((entry) => ids.some((alias) => entry.waiting.has(alias))).map(({ workspace }) => ({ id: workspace.id, name: workspace.name }));
    rows.push({ id, app, label: app?.label ?? id, type: app?.kind === "remote" || app?.kind === "custom" ? "MCP" : "Connector", category: app ? CATEGORY_NAMES[app.categories[0] ?? "other"] : "Other", status: needsAuth.length ? "needs-auth" : "ready", tools: extras?.tools ?? null, permissions: extras?.permissions ?? null, workspaces: linked, needsAuth });
  };
  for (const app of apps) add(app.id, app, idsOf(app));
  const unknown = new Map<string, string>();
  for (const { workspace } of connected) for (const id of connections[workspace.id] ?? []) {
    const lower = id.toLowerCase();
    if (!known.has(lower) && !unknown.has(lower)) unknown.set(lower, id);
  }
  for (const [lower, id] of unknown) add(id, null, [lower]);
  return rows.sort((a, b) => Number(b.status === "needs-auth") - Number(a.status === "needs-auth") || popularity(a) - popularity(b) || a.label.localeCompare(b.label));
}
