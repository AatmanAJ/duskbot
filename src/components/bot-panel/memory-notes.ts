import { MEMORY_INDEX, type MemoryDoc } from "@/lib/memory";
import { parseTopicHeader, topicBody } from "../../../shared/memory-topics";

/** The bullet lines of MEMORY.md, each with the line it sits on so one can be taken out again. */
export interface MemoryNote {
  line: number;
  text: string;
}

const BULLET = /^\s*[-*]\s+(.+?)\s*$/;

export function memoryNotes(text: string): MemoryNote[] {
  return text.split("\n").flatMap((raw, line) => {
    const note = BULLET.exec(raw)?.[1];
    return note ? [{ line, text: note }] : [];
  });
}

export function withoutMemoryNote(text: string, line: number): string {
  const lines = text.split("\n");
  if (!BULLET.test(lines[line] ?? "")) return text;
  lines.splice(line, 1);
  return lines.join("\n");
}

export function withMemoryNote(text: string, note: string): string {
  const body = text.replace(/\s+$/, "");
  const bullet = `- ${note.trim().replace(/\s*\n\s*/g, " ")}`;
  return body ? `${body}\n${bullet}\n` : `${bullet}\n`;
}

/** A note of one file: a bullet of it, or, for a topic file without bullets, the whole file (`line` null). `topic`
 * names its topic file, null for MEMORY.md. */
export interface PanelMemoryNote {
  path: string;
  topic: string | null;
  line: number | null;
  text: string;
}

/** Struck through by a correction or a merge: history the bot no longer loads, not something it knows now. */
const STRUCK = /^(?:\d{4}-\d{2}-\d{2} · (?:from [^·\n]* · )?)?~~/;

/** A topic file's own title, else its file name in words. */
export function memoryTopicName(doc: Pick<MemoryDoc, "path" | "text">): string {
  const name = parseTopicHeader(doc.text).title ?? doc.path.replace(/^memory\//, "").replace(/\.md$/, "").replace(/[-_]+/g, " ").trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function panelMemoryNotes(docs: readonly MemoryDoc[]): PanelMemoryNote[] {
  return docs.flatMap((doc): PanelMemoryNote[] => {
    const topic = doc.path === MEMORY_INDEX ? null : memoryTopicName(doc);
    const all = memoryNotes(doc.text);
    if (all.length || doc.path === MEMORY_INDEX) return all.filter((note) => !STRUCK.test(note.text)).map((note) => ({ path: doc.path, topic, ...note }));
    const text = topicBody(doc.text).split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).filter(Boolean).join(" ");
    return text ? [{ path: doc.path, topic, line: null, text }] : [];
  });
}
