import assert from "node:assert/strict";
import test from "node:test";
import type { DashApp } from "./connectors.ts";
import { connectedInAppOn, connectorRows, FIXTURE_EXTRAS, withPending } from "./connector-rows.ts";

const workspaces = [{ id: "mac", name: "My Mac" }, { id: "vps", name: "My VPS" }];
const app = (id: string, fields: Partial<DashApp> = {}): DashApp => ({ id, label: id, kind: "composio", description: "An app", categories: ["productivity"], icon: {}, ...fields });

test("connectorRows sorts auth failures first, then popularity and labels", () => {
  const apps = [app("notion"), app("slack"), app("github"), app("gmail"), app("figma"), app("linear"), app("zeta", { label: "Zeta" }), app("alpha", { label: "Alpha" }), app("unused")];
  const rows = connectorRows(apps, { mac: apps.filter((entry) => entry.id !== "unused").map((entry) => entry.id) }, workspaces, FIXTURE_EXTRAS);
  assert.deepEqual(rows.map((row) => row.id), ["linear", "figma", "gmail", "slack", "github", "notion", "alpha", "zeta"]);
  assert.deepEqual(rows.map((row) => [row.status, row.tools, row.permissions]), [["needs-auth", 0, null], ["needs-auth", null, null], ["ready", 14, "Ask first"], ["ready", 9, "Allowed"], ["ready", 26, "Ask first"], ["ready", 12, "Allowed"], ["ready", null, null], ["ready", null, null]]);
  assert.deepEqual(connectorRows([], {}, workspaces), []);
});

test("connectorRows matches every alias case-insensitively and lists workspaces once", () => {
  const merged = app("Notes", { aliases: ["NOTION"], composio: "notion_api", remote: "notion-mcp", label: "Notes" });
  const connections = { mac: ["notes", "Notion", "NOTION_API"], vps: ["NOTION-MCP"], outside: ["Notes"] };
  const rows = connectorRows([merged], connections, workspaces, FIXTURE_EXTRAS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, "Notes");
  assert.equal(rows[0]!.app, merged);
  assert.deepEqual(rows[0]!.workspaces, workspaces);
  assert.equal(rows[0]!.tools, 12);
  assert.equal(rows[0]!.permissions, "Allowed");
  for (const id of ["notes", "Notion", "NOTION_API", "NOTION-MCP"]) assert.equal(connectorRows([merged], { mac: [id] }, workspaces).length, 1);
});

test("unknown ids get one catalog-free row across workspaces", () => {
  const rows = connectorRows([], { mac: ["Private-MCP", "Private-MCP"], vps: ["PRIVATE-mcp"], outside: ["ignored"] }, workspaces, { "private-mcp": { status: "needs-auth", tools: 4, permissions: "Ask first" } });
  assert.deepEqual(rows, [{ id: "Private-MCP", app: null, label: "Private-MCP", type: "Connector", category: "Other", status: "needs-auth", tools: 4, permissions: "Ask first", workspaces, needsAuth: workspaces }]);
  assert.deepEqual(connectorRows([], { mac: ["unknown"] }, []), []);
});

test("connectorRows derives MCP types, categories and defaults", () => {
  const apps = [app("remote", { kind: "remote", categories: ["code", "design"] }), app("custom", { kind: "custom", categories: [] }), app("gmail", { categories: ["communication"] })];
  const rows = connectorRows(apps, { mac: ["remote", "custom", "gmail"] }, workspaces);
  assert.deepEqual(rows.map((row) => [row.id, row.type, row.category, row.status, row.tools, row.permissions]), [["gmail", "Connector", "Communication", "ready", null, null], ["custom", "MCP", "Other", "ready", null, null], ["remote", "MCP", "Code", "ready", null, null]]);
});

test("a started sign-in shows as needing sign-in until the app connects there", () => {
  const shown = withPending({ mac: ["gmail"], vps: [] }, { mac: ["Gmail", "linear"], vps: ["linear"] }, { linear: { status: "ready", tools: 3 }, gmail: { status: "needs-auth" } });
  assert.deepEqual(shown.connections, { mac: ["gmail", "linear"], vps: ["linear"] });
  assert.deepEqual(shown.extras, { linear: { tools: 3 }, gmail: {} });
  assert.deepEqual(shown.pending, { mac: ["linear"], vps: ["linear"] });
});

test("sign-in is asked only on the workspaces where it was started", () => {
  const shown = withPending({ mac: ["figma"], vps: [] }, { vps: ["Figma"] });
  const [row] = connectorRows([app("figma")], shown.connections, workspaces, shown.extras, shown.pending);
  assert.equal(row!.status, "needs-auth");
  assert.deepEqual(row!.workspaces, workspaces);
  assert.deepEqual(row!.needsAuth, [{ id: "vps", name: "My VPS" }]);
  const [ready] = connectorRows([app("figma")], { mac: ["figma"] }, workspaces, {}, { vps: ["figma"] });
  assert.equal(ready!.status, "ready");
  assert.deepEqual(ready!.needsAuth, []);
});

test("connectedInAppOn finds an app connected in the app by any of its ids, on that workspace only", () => {
  const inApp = { mac: ["linear", "Notion"] };
  assert.equal(connectedInAppOn(inApp, "mac", ["linear", null]), true);
  assert.equal(connectedInAppOn(inApp, "mac", ["notes", "notion"]), true);
  assert.equal(connectedInAppOn(inApp, "vps", ["linear"]), false);
  assert.equal(connectedInAppOn(inApp, "mac", ["github", undefined]), false);
});
