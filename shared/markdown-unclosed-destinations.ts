import { fromMarkdown } from "mdast-util-from-markdown";

/**
 * Models sometimes write a local file link as `[name](</abs/path/file.docx)`, dropping the closing `>`. CommonMark
 * then reads the whole link as text, so the reply shows the raw path. Only a destination that opens with an absolute
 * local path (POSIX, drive letter, UNC or file://) and runs, with balanced parentheses, to the link's `)` on the same
 * line is closed. The server and the client both read messages through this, so the file authorized is the file
 * rendered.
 */
const UNCLOSED_FILE_DESTINATION =
  /\[[^[\]\n]*\]\(<((?:file:\/\/|\/(?!\/)|[A-Za-z]:[\\/]|\\\\)(?:[^<>()\n]|\([^<>()\n]*\))*)(?<!\\)\)/g;

type Node = { type: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
const LITERAL = new Set(["code", "inlineCode", "html"]);

function literalRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pending: Node[] = [fromMarkdown(markdown) as Node];
  while (pending.length) {
    const node = pending.pop()!;
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (LITERAL.has(node.type) && start !== undefined && end !== undefined) ranges.push([start, end]);
    else if (node.children) pending.push(...node.children);
  }
  return ranges;
}

export interface ClosedFileLinks {
  markdown: string;
  /** Offsets in the original text where a `>` was inserted, ascending. */
  inserted: number[];
}

export function closeUnclosedFileLinks(markdown: string): ClosedFileLinks {
  if (!markdown.includes("](<")) return { markdown, inserted: [] };
  const matches = [...markdown.matchAll(UNCLOSED_FILE_DESTINATION)];
  if (!matches.length) return { markdown, inserted: [] };
  const literal = literalRanges(markdown);
  const inserted = matches
    .filter((match) => !literal.some(([start, end]) => match.index >= start && match.index < end))
    .map((match) => match.index + match[0].length - 1);
  if (!inserted.length) return { markdown, inserted };
  let closed = "", from = 0;
  for (const at of inserted) {
    closed += `${markdown.slice(from, at)}>`;
    from = at;
  }
  return { markdown: closed + markdown.slice(from), inserted };
}

export function originalOffset(closedOffset: number, inserted: readonly number[]): number {
  let shift = 0;
  while (shift < inserted.length && inserted[shift]! + shift < closedOffset) shift += 1;
  return closedOffset - shift;
}
