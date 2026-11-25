export const ARCHIVE_TOPIC = "archive.md";
const ARCHIVE_YEAR = /^archive-\d{4}\.md$/;

/** The archive and its yearly rolls: history, never current notes. */
export function isArchiveTopic(name: string): boolean {
  return name === ARCHIVE_TOPIC || ARCHIVE_YEAR.test(name);
}

/** A memory/<topic>.md may begin with YAML frontmatter: `title`, `description`, `aliases`. */
export interface TopicHeader {
  title?: string;
  description?: string;
  aliases: string[];
}

function unquote(value: string): string {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1).trim();
  return v;
}

export function parseTopicHeader(text: string): TopicHeader {
  const header: TopicHeader = { aliases: [] };
  const lead = /^(?:\s*\r?\n|#{1,6}[ \t]+[^\r\n]*\r?\n)*/.exec(text)?.[0] ?? "";
  const heading = /^#{1,6}[ \t]+([^\r\n]+)/m.exec(lead)?.[1]?.trim();
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text.slice(lead.length));
  if (!m) {
    if (heading) header.title = heading.slice(0, 160);
    return header;
  }
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const field = /^(title|description|aliases|tags)\s*:\s*(.*)$/.exec(lines[i]);
    if (!field) continue;
    const [, key, value] = field;
    if (key === "title" || key === "description") {
      if (value.trim()) header[key] = unquote(value).slice(0, 160);
      continue;
    }
    const items: string[] = [];
    if (value.trim().startsWith("[")) {
      items.push(...value.trim().replace(/^\[|\]$/g, "").split(","));
    } else if (value.trim()) {
      items.push(...value.split(","));
    } else {
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) items.push(lines[(i += 1)].replace(/^\s*-\s+/, ""));
    }
    for (const item of items.map(unquote).filter(Boolean)) {
      if (!header.aliases.includes(item)) header.aliases.push(item.slice(0, 40));
    }
  }
  header.aliases = header.aliases.slice(0, 12);
  if (!header.title && heading) header.title = heading.slice(0, 160);
  return header;
}

export function topicBody(text: string): string {
  const lead = /^(?:\s*\r?\n|#{1,6}[ \t]+[^\r\n]*\r?\n)*/.exec(text)?.[0] ?? "";
  const rest = text.slice(lead.length).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  return rest.trim();
}
