// A dusk cloud's bots on the person's own screen (docs/cloud-uses-mac.md): the computer-control driver on the Mac lists
// its tools in a sealed job, and the cloud offers them as mac_<tool> on the device server, filtered as a local bot's
// computer is beside a browser of its own.
import { CLOUD_ONLY_MAC_TOOL_NAMES, MAC_TOOL_NAMES, type MacJobOutcome } from "../../shared/mac-control.ts";
import { listsComputerTool } from "../computer-tool-list.ts";
import type { MacToolResult } from "./tools.ts";

export const SCREEN_PREFIX = "mac_";
const DRIVER_NAME = /^[a-z][a-z0-9_]{0,47}$/;
const MAX_TOOLS = 80;
const DESCRIPTION_MAX = 4000;
const SCHEMA_MAX = 16_000;
const OWN_NAMES: ReadonlySet<string> = new Set([...MAC_TOOL_NAMES, ...CLOUD_ONLY_MAC_TOOL_NAMES]);

export interface ScreenTool { name: string; description: string; inputSchema: Record<string, unknown> }

export interface ScreenCatalog {
  /** The driver's version as the Mac read it; "" when it did not say. */
  driver: string;
  tools: ScreenTool[];
  /** listed name -> the driver's own name */
  driverName: Map<string, string>;
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** The catalog from a mac_screen_tools job's text, or null when it is not one. */
export function screenCatalog(text: string): ScreenCatalog | null {
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  if (!isObject(body) || !Array.isArray(body.tools)) return null;
  const tools: ScreenTool[] = [];
  const driverName = new Map<string, string>();
  for (const entry of body.tools.slice(0, 200)) {
    if (!isObject(entry) || typeof entry.name !== "string" || !DRIVER_NAME.test(entry.name) || !listsComputerTool(entry.name, true)) continue;
    const name = `${SCREEN_PREFIX}${entry.name}`;
    if (OWN_NAMES.has(name) || driverName.has(name)) continue;
    const schema = isObject(entry.inputSchema) && entry.inputSchema.type === "object" && JSON.stringify(entry.inputSchema).length <= SCHEMA_MAX
      ? entry.inputSchema : { type: "object" };
    const description = typeof entry.description === "string" ? entry.description.slice(0, DESCRIPTION_MAX) : "";
    tools.push({ name, description: `On the person's own computer (their screen): ${description}`.trim(), inputSchema: schema });
    driverName.set(name, entry.name);
    if (tools.length >= MAX_TOOLS) break;
  }
  return { driver: typeof body.driver === "string" ? body.driver.slice(0, 40) : "", tools, driverName };
}

/** A name the device server may route to the screen: mac_ and not one of the Mac's own tools. */
export const maybeScreenTool = (name: unknown): name is string =>
  typeof name === "string" && name.startsWith(SCREEN_PREFIX) && !OWN_NAMES.has(name) && DRIVER_NAME.test(name.slice(SCREEN_PREFIX.length));

/** A mac_screen job's outcome as the driver's own MCP result. */
export function screenResult(outcome: MacJobOutcome): MacToolResult {
  if (!outcome.ok) return { content: [{ type: "text", text: outcome.error }], isError: true };
  const { text, image, structured, isError } = outcome.result;
  return {
    content: [...(text || !image ? [{ type: "text" as const, text }] : []), ...(image ? [{ type: "image" as const, ...image }] : [])],
    ...(structured ? { structuredContent: structured } : {}),
    ...(isError ? { isError: true } : {}),
  };
}
