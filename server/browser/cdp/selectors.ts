import { DriverError, messageOf } from "./errors.ts";
import { callInWorld, callOnNode } from "./evaluate.ts";
import type { FrameTree } from "./frames.ts";
import { parseRef, type NodeHandle, type RefTable } from "./refs.ts";
import { liveRef } from "./relocate.ts";

/**
 * A selector names elements in the main frame, open shadow roots included:
 * CSS (optionally `css=`), `role=button[name="Save"]` (accessible role and exact
 * name; `name*=` matches part of it) or `text=Save` (`text="Save"` is exact).
 * Refs from a snapshot reach iframes and closed shadow roots.
 */
export type Selector = { engine: "css"; css: string } | { engine: "role"; role: string; name?: string; partial: boolean } | { engine: "text"; text: string; exact: boolean };

const ROLE = /^role=([a-zA-Z]+)\s*(?:\[\s*name\s*(\*?)=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\])?$/;

export function parseSelector(input: string): Selector {
  const selector = input.trim();
  if (!selector) throw new DriverError("invalid-selector", "The selector is empty.");
  if (selector.startsWith("role=")) {
    const match = ROLE.exec(selector);
    if (!match) throw new DriverError("invalid-selector", `Cannot read the role selector ${selector}. Write it as role=button[name="Save"].`);
    const raw = match[3] ?? match[4];
    return { engine: "role", role: match[1]!.toLowerCase(), ...(raw === undefined ? {} : { name: raw.replace(/\\(.)/g, "$1") }), partial: match[2] === "*" };
  }
  if (selector.startsWith("text=")) {
    const text = selector.slice(5).trim();
    const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(text) ?? /^'((?:[^'\\]|\\.)*)'$/.exec(text);
    if (quoted) return { engine: "text", text: quoted[1]!.replace(/\\(.)/g, "$1"), exact: true };
    if (!text) throw new DriverError("invalid-selector", "The text selector is empty.");
    return { engine: "text", text, exact: false };
  }
  return { engine: "css", css: selector.startsWith("css=") ? selector.slice(4) : selector };
}

const QUERY_CSS = `function (css, pick) {
  const all = (root, selector) => {
    const out = [];
    const visit = (at) => {
      for (const element of at.querySelectorAll(selector)) out.push(element);
      for (const element of at.querySelectorAll("*")) if (element.shadowRoot) visit(element.shadowRoot);
    };
    visit(root);
    return out;
  };
  // Playwright's :has-text("…"), which models write by habit: the elements on its left whose text holds it.
  const hasText = /^(.*?):has-text\\((["'])(.*?)\\2\\)(.*)$/.exec(css);
  let found;
  if (hasText) {
    const wanted = hasText[3].toLowerCase();
    const base = all(this, hasText[1].trim() || "*").filter((element) => (element.innerText || "").toLowerCase().includes(wanted));
    const holders = hasText[1].trim() ? base : base.filter((element) => !base.some((other) => other !== element && element.contains(other)));
    const rest = hasText[4].trim();
    found = rest ? holders.flatMap((element) => [...element.querySelectorAll(rest.startsWith(">") ? ":scope " + rest : rest)]) : holders;
  } else {
    found = all(this, css);
  }
  found = [...new Set(found)];
  return typeof pick === "number" ? found[pick] ?? null : found.length === 1 ? found[0] : found.length;
}`;

const QUERY_TEXT = `function (text, exact, pick) {
  const normal = (value) => value.replace(/\\s+/g, " ").trim();
  const wanted = exact ? normal(text) : normal(text).toLowerCase();
  const matches = (element) => {
    if (element.checkVisibility && !element.checkVisibility()) return false;
    const own = normal(element.innerText ?? element.textContent ?? "");
    return exact ? own === wanted : own.toLowerCase().includes(wanted);
  };
  const found = [];
  const visit = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let element = walker.nextNode(); element; element = walker.nextNode()) {
      if (element.shadowRoot) visit(element.shadowRoot);
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD"].includes(element.tagName)) continue;
      if (matches(element) && ![...element.children].some(matches)) found.push(element);
    }
  };
  visit(this);
  return typeof pick === "number" ? found[pick] ?? null : found.length === 1 ? found[0] : found.length;
}`;

interface AXQueryNode {
  backendDOMNodeId?: number;
  ignored?: boolean;
  name?: { value?: unknown };
}

async function queryRole(frames: FrameTree, selector: Extract<Selector, { engine: "role" }>): Promise<number[]> {
  const session = frames.mainSession;
  const { root } = await session.send<{ root: { backendNodeId: number } }>("DOM.getDocument", { depth: 0 });
  const exactName = selector.name !== undefined && !selector.partial ? { accessibleName: selector.name } : {};
  const { nodes } = await session.send<{ nodes: AXQueryNode[] }>("Accessibility.queryAXTree", { backendNodeId: root.backendNodeId, role: selector.role, ...exactName });
  const wanted = selector.partial && selector.name !== undefined ? selector.name.toLowerCase() : null;
  return nodes
    .filter((node) => !node.ignored && typeof node.backendDOMNodeId === "number")
    .filter((node) => wanted === null || String(node.name?.value ?? "").toLowerCase().includes(wanted))
    .map((node) => node.backendDOMNodeId!);
}

/** Roles a model names as if they were tags: `textbox`, `button[name="Send"]`. Tried as a role when no element matches as CSS. */
const ROLE_WORDS = new Set(["button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox", "option", "menuitem", "menu", "tab", "switch",
  "slider", "spinbutton", "heading", "dialog", "status", "alert", "img", "row", "cell", "gridcell", "navigation", "region", "article", "list", "listitem",
  "table", "grid", "tabpanel", "treeitem", "form", "banner", "main", "complementary"]);
const ROLEISH = /^([a-z]+)(?:\[\s*name\s*(\*?)=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\])?$/u;

function asRole(selector: Selector): Extract<Selector, { engine: "role" }> | null {
  if (selector.engine !== "css") return null;
  const match = ROLEISH.exec(selector.css.trim());
  if (!match || !ROLE_WORDS.has(match[1]!)) return null;
  const name = match[3] ?? match[4];
  return { engine: "role", role: match[1]!, ...(name === undefined ? {} : { name: name.replace(/\\(.)/gu, "$1") }), partial: match[2] === "*" };
}

/** Every match (CSS and text return a count instead of nodes when there is more than one). */
async function query(frames: FrameTree, selector: Selector): Promise<{ count: number; backendNodeId?: number }> {
  if (selector.engine === "role") {
    const ids = [...new Set(await queryRole(frames, selector))];
    return { count: ids.length, ...(ids.length === 1 ? { backendNodeId: ids[0] } : {}) };
  }
  const fn = selector.engine === "css" ? QUERY_CSS : QUERY_TEXT;
  const args = selector.engine === "css" ? [selector.css, null] : [selector.text, selector.exact, null];
  let answer: Awaited<ReturnType<typeof callInWorld>>;
  try {
    answer = await callInWorld(frames, frames.mainFrameId, fn, args);
  } catch (error) {
    if (selector.engine === "css" && /SyntaxError|not a valid selector/i.test(messageOf(error))) {
      const role = asRole(selector);
      if (role) return query(frames, role);
      throw new DriverError("invalid-selector", `${selector.css} is not a valid CSS selector. Use a ref from the snapshot, text=…, or role=button[name="…"].`);
    }
    throw error;
  }
  const { session, result } = answer;
  if (result.type === "number") {
    const count = Number(result.value);
    const role = count === 0 ? asRole(selector) : null;
    return role ? query(frames, role) : { count };
  }
  if (!result.objectId) return { count: 0 };
  try {
    const { node } = await session.send<{ node: { backendNodeId: number } }>("DOM.describeNode", { objectId: result.objectId });
    return { count: 1, backendNodeId: node.backendNodeId };
  } finally {
    void session.send("Runtime.releaseObject", { objectId: result.objectId }).catch(() => {});
  }
}

/** Up to six of the elements a selector matches, in page order. */
async function matches(frames: FrameTree, selector: Selector): Promise<number[]> {
  const role = selector.engine === "role" ? selector : asRole(selector);
  if (role) {
    const ids = [...new Set(await queryRole(frames, role))];
    if (ids.length || selector.engine === "role") return ids.slice(0, 6);
  }
  if (selector.engine === "role") return [];
  const fn = selector.engine === "css" ? QUERY_CSS : QUERY_TEXT;
  const ids: number[] = [];
  for (let pick = 0; pick < 6; pick++) {
    const { session, result } = await callInWorld(frames, frames.mainFrameId, fn, selector.engine === "css" ? [selector.css, pick] : [selector.text, selector.exact, pick]);
    if (!result.objectId) break;
    try {
      const { node } = await session.send<{ node: { backendNodeId: number } }>("DOM.describeNode", { objectId: result.objectId });
      ids.push(node.backendNodeId);
    } finally {
      void session.send("Runtime.releaseObject", { objectId: result.objectId }).catch(() => {});
    }
  }
  return ids;
}

const DESCRIBE = `function () {
  const text = (this.getAttribute("aria-label") || this.innerText || this.value || "").replace(/\\s+/g, " ").trim().slice(0, 60);
  const r = this.getBoundingClientRect();
  const where = r.width <= 0 || r.height <= 0 ? " (hidden)" : r.bottom < 0 || r.top > innerHeight ? " (off screen)" : "";
  return "<" + this.tagName.toLowerCase() + ">" + (text ? " " + JSON.stringify(text) : "") + where;
}`;

/** What an ambiguous selector matched, each with a ref to pick it by. */
async function ambiguity(frames: FrameTree, refs: RefTable, input: string, count: number): Promise<DriverError> {
  try {
    const ids = await matches(frames, parseSelector(input));
    const listed = await Promise.all(ids.map(async (backendNodeId) => {
      const handle = { frameId: frames.mainFrameId, session: frames.mainSession, backendNodeId };
      const described = await callOnNode<string>(frames, handle, DESCRIBE).catch(() => "an element");
      return `${refs.refFor(handle)} ${described}`;
    }));
    if (listed.length) {
      return new DriverError("ambiguous", `${input} matches ${count} elements, so nothing was done. ${count > listed.length ? "The first ones" : "They"}: ${listed.join("; ")}. Pass the ref of the one you mean.`, { count });
    }
  } catch {}
  return new DriverError("ambiguous", `strict mode violation: ${input} matches ${count} elements. Use a ref from a snapshot, or a selector that names one element.`, { count });
}

export async function countSelector(frames: FrameTree, input: string): Promise<number> {
  return (await query(frames, parseSelector(input))).count;
}

/** Exactly one element, or an error: an ambiguous selector never acts on the first match. */
export async function resolveSelector(frames: FrameTree, input: string): Promise<NodeHandle> {
  const { count, backendNodeId } = await query(frames, parseSelector(input));
  if (count === 0) throw new DriverError("not-found", `No element matches ${input}.`);
  if (count > 1 || backendNodeId === undefined) {
    throw new DriverError("ambiguous", `strict mode violation: ${input} matches ${count} elements. Use a ref from a snapshot, or a selector that names one element.`, { count });
  }
  return { frameId: frames.mainFrameId, session: frames.mainSession, backendNodeId };
}

/** A ref, or a selector that reads as one ("aria-ref=e5"), resolves through the tab's refs to the element as it is now. */
export async function resolveElement(frames: FrameTree, refs: RefTable, target: { ref?: string; selector?: string }): Promise<NodeHandle & { ref?: string }> {
  if (target.ref !== undefined) return liveRef(frames, refs, target.ref);
  if (target.selector === undefined) throw new DriverError("invalid-selector", "Name the element with a ref or a selector.");
  if (parseRef(target.selector)) return liveRef(frames, refs, target.selector);
  try {
    return await resolveSelector(frames, target.selector);
  } catch (error) {
    if (error instanceof DriverError && error.code === "ambiguous") throw await ambiguity(frames, refs, target.selector, Number(error.detail?.count ?? 2));
    throw error;
  }
}
