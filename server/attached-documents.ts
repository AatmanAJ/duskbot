// Every engine reads an attached document, with or without a shell or a helper model: the text of each PDF, Word,
// Excel, PowerPoint or OpenDocument upload the person attached rides in the turn right under its tag. Only the app's own
// uploads are read (a uuid name straight inside the attachments folder, no link), so a tag typed into prose never opens
// another file.
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { ATTACHMENTS_DIR } from "./attachments.ts";
import type { TurnImageInput } from "./contracts.ts";
import { DOCUMENT_EXTENSIONS, documentText, DocumentTextError, pdfPagePictures } from "./document-text.ts";
import { decodeAttachmentAttribute } from "./message-file.ts";

/** Characters of document text one turn carries; past it the bot is told to read the rest with extract. */
export const ATTACHED_TEXT_MAX_CHARS = 60_000;
const DOCUMENTS_PER_TURN = 6;
const SCANNED_PAGES = 4;

const FILE_TAG = /^<attached-file[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>[\t ]*$/gm;
const OWNED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z]+$/;

type Read = { text: string } | { scanned: true } | { problem: string };

async function ownedDocument(path: string, attachmentsDir: string): Promise<string | null> {
  const name = basename(path);
  if (!OWNED_NAME.test(name) || !DOCUMENT_EXTENSIONS.has(extname(name)) || resolve(path) !== resolve(attachmentsDir, name)) return null;
  try {
    const entry = await lstat(resolve(attachmentsDir, name));
    if (!entry.isFile() || entry.isSymbolicLink()) return null;
    return dirname(await realpath(resolve(attachmentsDir, name))) === await realpath(attachmentsDir) ? resolve(attachmentsDir, name) : null;
  } catch {
    return null;
  }
}

/** Uploads never change under their name, so a document's text is read once and kept beside the uploads. */
async function readOnce(path: string, cacheDir: string): Promise<Read> {
  const cached = join(cacheDir, `${basename(path)}.txt`);
  const kept = await readFile(cached, "utf8").catch(() => null);
  if (kept !== null) return { text: kept };
  try {
    const text = await documentText(await readFile(path), extname(path));
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const partial = `${cached}.${process.pid}.partial`;
    await writeFile(partial, text, { mode: 0o600 });
    await rename(partial, cached);
    return { text };
  } catch (error) {
    if (error instanceof DocumentTextError) return error.scanned ? { scanned: true } : { problem: error.message };
    return { problem: "That file could not be read." };
  }
}

const quoteName = (name: string) => name.replace(/["<>\r\n]/g, "").slice(0, 200) || "document";
/** A document cannot close its own block early and pose as the person's words. */
const fenced = (text: string) => text.replace(/<\/?attached-file-text\b/gi, (tag) => tag.replace("<", "&lt;"));

export interface AttachedDocumentsOptions {
  /** The engine takes images: a scanned PDF's first pages go along as pictures. */
  vision: boolean;
  /** Pictures the turn already carries, so pages never push it past its image count. */
  imageRoom: number;
  attachmentsDir?: string;
  cacheDir?: string;
}

export async function withAttachedDocuments(text: string, options: AttachedDocumentsOptions): Promise<{ text: string; images: TurnImageInput[] }> {
  if (!text.includes("<attached-file")) return { text, images: [] };
  const attachmentsDir = options.attachmentsDir ?? ATTACHMENTS_DIR;
  const cacheDir = options.cacheDir ?? join(dirname(attachmentsDir), "attachment-text");
  const tags = [...text.matchAll(FILE_TAG)].slice(0, DOCUMENTS_PER_TURN);
  const images: TurnImageInput[] = [];
  let budget = ATTACHED_TEXT_MAX_CHARS;
  let out = "", from = 0;
  const seen = new Set<string>();
  for (const tag of tags) {
    const path = await ownedDocument(decodeAttachmentAttribute(tag[1]!), attachmentsDir);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const name = quoteName(decodeAttachmentAttribute(tag[2] ?? basename(path)));
    const read = await readOnce(path, cacheDir);
    let block: string;
    if ("text" in read) {
      const shown = read.text.slice(0, Math.max(0, budget));
      budget -= shown.length;
      const rest = read.text.length - shown.length;
      block = (shown ? `<attached-file-text name="${name}">\n${fenced(shown)}\n</attached-file-text>` : "")
        + (rest > 0 ? `\n[${rest.toLocaleString("en-US")} more characters of ${name} are not shown here: read the rest with the extract tool on this file.]` : "");
    } else if ("scanned" in read) {
      const room = Math.min(SCANNED_PAGES, options.imageRoom - images.length);
      const pages = options.vision && room > 0 ? await pdfPagePictures(path, join(cacheDir, `${basename(path)}-pages`), room) : [];
      for (const page of pages) images.push({ path: page, mime: "image/png", bytes: (await lstat(page)).size });
      block = pages.length
        ? `[${name} is a scanned PDF with no text layer: ${pages.length === 1 ? "its first page is attached as a picture" : `its first ${pages.length} pages are attached as pictures`}.]`
        : `[${name} is a scanned PDF with no text layer, so its words cannot be read here. Ask for a text PDF or photos of the pages.]`;
    } else {
      block = `[${name} could not be read: ${read.problem}]`;
    }
    const end = tag.index! + tag[0].length;
    out += text.slice(from, end) + "\n" + block;
    from = end;
  }
  return { text: out + text.slice(from), images };
}
