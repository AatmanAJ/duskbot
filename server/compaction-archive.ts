import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { redactSecretsInText } from "./redact.ts";

export interface ArchivedCall {
  name: string;
  ok?: boolean;
  input?: string;
  /** The full result when the harness kept one, else the preview the chat holds. */
  result?: string;
}

export const ARCHIVE_DIR = "context-archive";
const CALL_MAX_CHARS = 24_000;
const FILE_MAX_CHARS = 1_000_000;

function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}

function clipped(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[… ${text.length - max} more characters not kept]` : text;
}

export function renderToolArchive(calls: readonly ArchivedCall[]): string {
  const parts = [
    "# Tool results from the earlier part of this conversation",
    "Saved word for word (secrets masked) when the conversation was summarized, oldest first. Search it for the exact result you need rather than reading it all.",
  ];
  let size = parts.join("\n\n").length;
  let omitted = 0;
  for (const [index, call] of calls.entries()) {
    const status = call.ok === true ? "ok" : call.ok === false ? "failed" : "no result recorded";
    const block = [
      `## ${index + 1}. ${redactSecretsInText(call.name).replace(/\s+/g, " ").slice(0, 200)} (${status})`,
      ...(call.input?.trim() ? ["Input:", fenced(clipped(redactSecretsInText(call.input), 4_000))] : []),
      call.result?.trim() ? `Result:\n${fenced(clipped(redactSecretsInText(call.result), CALL_MAX_CHARS))}` : "Result: none recorded",
    ].join("\n");
    if (size + block.length > FILE_MAX_CHARS) { omitted = calls.length - index; break; }
    parts.push(block);
    size += block.length + 2;
  }
  if (omitted) parts.push(`[${omitted} later calls did not fit in this file]`);
  return `${parts.join("\n\n")}\n`;
}

/** Writes the folded part's tool results into the chat's own folder, where the bot's file tools reach them. */
export function writeToolArchive(taskDir: string, name: string, calls: readonly ArchivedCall[]): { path: string; count: number } | null {
  if (!calls.length) return null;
  if (!/^[\w.-]{1,120}$/.test(name)) throw new Error("invalid archive name");
  const dir = join(taskDir, ARCHIVE_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${name}.md`);
  writeFileAtomic(path, renderToolArchive(calls), { mode: 0o600 });
  return { path, count: calls.length };
}

export function archivePointer(archive: { path: string; count: number }): string {
  return `- ${archive.path}: ${archive.count} tool result${archive.count === 1 ? "" : "s"} from before this point, word for word. Read or search it with your file tools when an exact earlier result matters.`;
}
