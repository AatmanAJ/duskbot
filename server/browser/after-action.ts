// What an action's answer adds about the page it left: the controls it brought up, with refs to act on at once, so the
// bot does not spend a call on a snapshot after every click that opens a menu, a dialog or a list.
import { valueInWorld } from "./cdp/evaluate.ts";
import { BUSY } from "./cdp/settle.ts";
import type { Tab } from "./tabs.ts";

/** The page counts as drawn once it has not changed for this long. */
const QUIET_MS = 200;
/** A page that never stops changing (a clock, a ticker) is read after this. */
const QUIET_MAX_MS = 1_000;
/** Loading placeholders that show are waited out this long at most. */
const BUSY_MAX_MS = 3_000;
const POLL_MS = 80;
export const MAX_NEW_LINES = 40;

const SIGNATURE = `(() => {
  const body = document.body;
  if (!body) return [0, 0, false];
  const shows = (el) => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0; };
  return [body.getElementsByTagName("*").length, body.innerText.length, [...document.querySelectorAll(${JSON.stringify(BUSY)})].slice(0, 50).some(shows)];
})()`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits briefly until what an action set off has drawn: a debounced search's options, a panel, a list after its skeleton. */
export async function settleAfterAction(tab: Tab, deadline: number, { textBefore = null }: { textBefore?: number | null } = {}): Promise<void> {
  const started = Date.now();
  let last = "";
  let since = started;
  for (;;) {
    let signature: [number, number, boolean];
    try {
      signature = await valueInWorld<[number, number, boolean]>(tab.page.frames, tab.page.frames.mainFrameId, SIGNATURE);
    } catch {
      return;
    }
    if (!Array.isArray(signature)) return;
    const now = Date.now();
    const key = `${signature[0]}:${signature[1]}`;
    if (key !== last) { last = key; since = now; }
    // a submit answered by the server (an inline error, the next step) shows only after its request comes back
    const waiting = textBefore !== null && signature[1] === textBefore && now - started < QUIET_MAX_MS;
    const busy = signature[2];
    if (!busy && !waiting && now - since >= QUIET_MS) return;
    if (now - started >= (busy ? BUSY_MAX_MS : QUIET_MAX_MS) || now + POLL_MS >= deadline) return;
    await sleep(POLL_MS);
  }
}

/** Containers named above a new control so it reads in place: the dialog, menu or list it opened in. */
const CONTEXT = /^- (?:dialog|alertdialog|listbox|menu|menubar|form|tablist|grid|table|list|region|group|navigation|tree|radiogroup|tabpanel)\b/u;
const REF = /\[ref=e(\d+)\]/u;

/** The snapshot lines whose refs are newer than `mark`, each under the dialog, menu or list it sits in. */
export function newElements(tree: string, mark: number, maxLines = MAX_NEW_LINES): { text: string; count: number } | null {
  const out: Array<{ depth: number; line: string }> = [];
  const stack: Array<{ depth: number; line: string; printed: boolean }> = [];
  let count = 0;
  let unnamed: { depth: number; at: number } | null = null;
  for (const raw of tree.split("\n")) {
    const depth = (raw.length - raw.trimStart().length) / 2;
    const line = raw.trim();
    while (stack.length && stack.at(-1)!.depth >= depth) stack.pop();
    // a control whose text sits on its own line below it reads as that text: `- generic [ref=e21]: Priya Raman`
    if (unnamed && depth === unnamed.depth + 1 && line.startsWith("- text: ")) {
      out[unnamed.at]!.line = `${out[unnamed.at]!.line}${line.slice("- text:".length)}`;
      unnamed = null;
    } else if (unnamed && depth <= unnamed.depth) {
      unnamed = null;
    }
    const ref = REF.exec(line);
    if (ref && Number(ref[1]) > mark) {
      count++;
      if (count <= maxLines) {
        for (const above of stack) if (!above.printed && CONTEXT.test(above.line)) { out.push({ depth: above.depth, line: above.line }); above.printed = true; }
        out.push({ depth, line });
        unnamed = line.endsWith(":") && !/^- \S+ "/u.test(line) ? { depth, at: out.length - 1 } : null;
      }
    }
    stack.push({ depth, line, printed: false });
  }
  if (!count) return null;
  const least = Math.min(...out.map((entry) => entry.depth));
  const lines = out.map((entry) => `${"  ".repeat(entry.depth - least)}${entry.line}`);
  if (count > maxLines) lines.push(`- … and ${count - maxLines} more; take a snapshot to see them all`);
  return { text: lines.join("\n"), count };
}

/** Blocks that hold one item of a list or feed: the text found is shown with the rest of its item and the item's refs. */
const ITEM = /^- (?:article|listitem|row|gridcell|cell|group|region|dialog|form|generic \[ref=)/u;
const depthOf = (line: string) => (line.length - line.trimStart().length) / 2;

/** The item of the snapshot that shows `wanted` (any case): its block, up to `maxLines`, or the matching line alone. */
export function around(tree: string, wanted: string, maxLines = 25): string | null {
  const lines = tree.split("\n");
  const needle = wanted.toLowerCase().replace(/\s+/gu, " ").trim();
  const at = lines.findIndex((line) => line.toLowerCase().includes(needle));
  if (at < 0) return null;
  let start = at;
  for (let i = at - 1, depth = depthOf(lines[at]!), levels = 0; i >= 0 && levels < 4; i--) {
    if (depthOf(lines[i]!) >= depth) continue;
    depth = depthOf(lines[i]!);
    levels++;
    if (ITEM.test(lines[i]!.trim())) { start = i; break; }
  }
  const base = depthOf(lines[start]!);
  const block = [lines[start]!];
  for (let i = start + 1; i < lines.length && depthOf(lines[i]!) > base && block.length < maxLines; i++) block.push(lines[i]!);
  return block.map((line) => line.slice(base * 2)).join("\n");
}

export function newElementsNote(found: { text: string } | null): string | null {
  return found ? `New on the page, with refs you can act on now:\n${found.text}` : null;
}
