import { DriverError, isGone } from "./errors.ts";
import { callOnNode } from "./evaluate.ts";
import type { FrameTree } from "./frames.ts";
import type { NodeHandle, RefTable } from "./refs.ts";
import type { AXNode } from "./snapshot.ts";

/** A ref a snapshot printed, with the role and name it printed it with. */
export interface Named {
  ref: string;
  frameId: string;
  role: string;
  name: string;
}

/** Roles whose element a ref may follow to a re-rendered copy; a generic element with a pointer cursor has no name to go by. */
const RELOCATABLE = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option", "menuitem",
  "menuitemcheckbox", "menuitemradio", "tab", "switch", "slider", "spinbutton", "treeitem",
]);
const SKIPPED = new Set(["InlineTextBox", "LineBreak", "ListMarker"]);
export const NAME_CHARS = 200;

export function cleanText(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

const axText = (value: AXNode["name"]) => (value?.value === undefined || value.value === null ? "" : String(value.value));

export function locateRefs(refs: RefTable, named: readonly Named[]): void {
  const groups = new Map<string, Named[]>();
  const seen = new Set<string>();
  for (const entry of named) {
    if (seen.has(entry.ref)) continue;
    seen.add(entry.ref);
    const key = `${entry.frameId}\u0000${entry.role}\u0000${entry.name}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.forEach((entry, nth) => refs.locate(entry.ref, { role: entry.role, name: entry.name, nth, count: group.length }));
  }
}

/** The frame's elements with this role and name, in the order a snapshot prints them. */
async function matching(frames: FrameTree, frameId: string, role: string, name: string): Promise<number[]> {
  const frame = frames.get(frameId);
  if (!frame) return [];
  const { nodes } = await frame.session.send<{ nodes: AXNode[] }>("Accessibility.getFullAXTree", { frameId });
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const found: number[] = [];
  const walk = (node: AXNode | undefined): void => {
    if (!node || SKIPPED.has(axText(node.role))) return;
    if (!node.ignored && axText(node.role) === role && node.backendDOMNodeId !== undefined && cleanText(axText(node.name), NAME_CHARS) === name) {
      found.push(node.backendDOMNodeId);
    }
    for (const id of node.childIds ?? []) walk(byId.get(id));
  };
  walk(nodes.find((node) => !node.parentId) ?? nodes[0]);
  return found;
}

const CONNECTED = "function () { return this.isConnected; }";

async function connected(frames: FrameTree, handle: NodeHandle): Promise<boolean> {
  try {
    return (await callOnNode<boolean>(frames, handle, CONNECTED)) === true;
  } catch (error) {
    if (isGone(error) || (error instanceof DriverError && error.code === "not-found")) return false;
    throw error;
  }
}

/**
 * The element now standing where a ref's was, when the page re-rendered it (a React composer swapped on focus): found
 * by the role and name the snapshot printed, and only when the frame has exactly as many such elements as it did then,
 * so a ref never moves to a different row's button. Null when there is no such one element.
 */
export async function relocate(frames: FrameTree, refs: RefTable, handle: NodeHandle & { ref: string }): Promise<(NodeHandle & { ref: string }) | null> {
  const locator = refs.locator(handle.ref);
  if (!locator || !RELOCATABLE.has(locator.role)) return null;
  let found: number[];
  try {
    found = await matching(frames, handle.frameId, locator.role, locator.name);
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
  if (found.length !== locator.count) return null;
  return refs.move(handle.ref, found[locator.nth]!);
}

export const goneRefError = (ref: string) =>
  new DriverError("stale-ref", `The element ${ref} is no longer on the page. Take a fresh snapshot and use its ref.`, { staleRef: true, ref });

/** A ref's element as the page has it now: the one the snapshot saw, or its re-rendered copy. */
export async function liveRef(frames: FrameTree, refs: RefTable, text: string): Promise<NodeHandle & { ref: string }> {
  const handle = refs.resolve(text);
  if (await connected(frames, handle)) return handle;
  const moved = await relocate(frames, refs, handle);
  if (moved) return moved;
  refs.forget(handle.ref);
  throw goneRefError(handle.ref);
}
