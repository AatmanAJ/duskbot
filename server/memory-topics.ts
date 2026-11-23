import { closeSync, openSync, readSync } from "node:fs";
import { parseTopicHeader, type TopicHeader } from "../shared/memory-topics.ts";

export { parseTopicHeader, type TopicHeader };

const HEAD_BYTES = 2_048;
export const TOPIC_INDEX_MAX_TOPICS = 40;
export const TOPIC_INDEX_MAX_CHARS = 2_000;

export function topicWords(name: string, header: TopicHeader): string[] {
  const text = [name.replace(/\.md$/i, "").replace(/[-_.]+/g, " "), header.title ?? "", header.description ?? "", ...header.aliases].join(" ");
  return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 3))];
}

export function readTopicHead(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = readSync(fd, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function renderTopicIndex(topics: ReadonlyArray<{ name: string; header: TopicHeader }>): string {
  if (!topics.length) return "";
  const archive = (name: string) => /^archive(?:-\d{4})?\.md$/.test(name);
  const ordered = [...topics].sort((a, b) => Number(archive(a.name)) - Number(archive(b.name)) || a.name.localeCompare(b.name));
  const lines: string[] = [];
  let length = 0;
  let omitted = 0;
  for (const { name, header } of ordered) {
    if (lines.length >= TOPIC_INDEX_MAX_TOPICS) {
      omitted += 1;
      continue;
    }
    const about = archive(name)
      ? "older notes moved out of MEMORY.md, kept for the record"
      : [header.title, header.description].filter(Boolean).join(": ");
    const also = header.aliases.length ? ` (also: ${header.aliases.join(", ")})` : "";
    const line = `- memory/${name}${about ? `: ${about}` : ""}${also}`.replace(/\s+/g, " ");
    if (length + line.length + 1 > TOPIC_INDEX_MAX_CHARS) {
      omitted += 1;
      continue;
    }
    lines.push(line);
    length += line.length + 1;
  }
  if (omitted) lines.push(`- …and ${omitted} more in memory/`);
  return lines.join("\n");
}

const LEAD = /^(?:\s*\r?\n|#{1,6}[ \t]+[^\r\n]*\r?\n)*/;
const HEADER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function aliasList(aliases: readonly string[]): string {
  return `[${aliases.join(", ")}]`;
}

export function mergeTopicText(existing: string | null, input: { title: string; aliases: readonly string[]; lines: readonly string[] }): string {
  const lines = input.lines.join("\n");
  if (existing === null || !existing.trim()) {
    const aliases = [...new Set(input.aliases)].slice(0, 12);
    return `---\ntitle: ${input.title}\n${aliases.length ? `aliases: ${aliasList(aliases)}\n` : ""}---\n\n${lines}\n`;
  }
  const lead = LEAD.exec(existing)?.[0] ?? "";
  const rest = existing.slice(lead.length);
  const block = HEADER_BLOCK.exec(rest);
  let text: string;
  if (!block) {
    const aliases = [...new Set(input.aliases)].slice(0, 12);
    text = `---\ntitle: ${parseTopicHeader(existing).title ?? input.title}\n${aliases.length ? `aliases: ${aliasList(aliases)}\n` : ""}---\n\n${existing}`;
  } else {
    const known = parseTopicHeader(existing).aliases;
    const lower = new Set(known.map((alias) => alias.toLowerCase()));
    const added = input.aliases.filter((alias) => !lower.has(alias.toLowerCase()));
    if (!added.length) text = existing;
    else {
      const merged = [...known, ...added].slice(0, 12);
      const body = block[1].split(/\r?\n/);
      const at = body.findIndex((line) => /^aliases\s*:/.test(line));
      if (at === -1) body.push(`aliases: ${aliasList(merged)}`);
      else {
        let end = at + 1;
        while (end < body.length && /^\s*-\s+/.test(body[end]!)) end += 1;
        body.splice(at, end - at, `aliases: ${aliasList(merged)}`);
      }
      text = `${lead}---\n${body.join("\n")}\n---\n${rest.slice(block[0].length)}`;
    }
  }
  return `${text}${text.endsWith("\n") ? "" : "\n"}${lines}\n`;
}
