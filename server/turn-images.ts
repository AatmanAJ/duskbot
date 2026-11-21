import { closeSync, lstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { fromMarkdown } from "mdast-util-from-markdown";

import { ATTACHMENTS_DIR, IMAGE_MAX_BYTES, imageMimeOf } from "./attachments.ts";
import type { TurnImageInput } from "./contracts.ts";
import { decodeAttachmentAttribute } from "./message-file.ts";

export const TURN_IMAGE_MAX_COUNT = 10;
/** Total image bytes one turn may carry: the 40 MB it was when a turn took four images, so engine requests don't grow. */
export const TURN_IMAGE_MAX_BYTES = 4 * IMAGE_MAX_BYTES;

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

type TagCandidate = { start: number; end: number; path: string };

/** Stands in for a stored picture whose bytes are no image, or after an engine refused one: the turn goes on without it. */
export const UNREADABLE_IMAGE_NOTE = "[An attached image could not be read, so it was left out.]";
const UNREADABLE = "unreadable" as const;

/** Engines' words for a picture they cannot decode (Gemini, Claude, OpenAI). */
export function engineRefusedImage(message: string | undefined): boolean {
  return /unable to process input image|could not process image|does not represent a valid image|image_parse_error|invalid image (?:data|format|file)|image (?:is )?(?:corrupt|invalid|could not be (?:decoded|processed|read))/i
    .test(message ?? "");
}

function headOf(path: string): Buffer {
  const head = Buffer.alloc(12);
  const fd = openSync(path, "r");
  try { return head.subarray(0, readSync(fd, head, 0, head.length, 0)); } finally { closeSync(fd); }
}

const OWNED_IMAGE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
const IMAGE_TAG =
  /^<attached-image[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>$/;

const MIME_BY_EXTENSION: Readonly<Record<string, TurnImageInput["mime"]>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function statusError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop()!;
    visit(current);
    const children = current.children ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) pending.push(children[index]!);
  }
}

/** Standalone tags only: prose that contains a tag literal must not become an attachment capability. */
function imageTagCandidates(text: string): TagCandidate[] {
  const candidates: TagCandidate[] = [];
  walk(fromMarkdown(text) as MarkdownNode, (node) => {
    if (node.type !== "html" || !node.value || !node.position) return;
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    if (start === undefined || end === undefined) return;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLine = text.indexOf("\n", end);
    const lineEnd = nextLine < 0 ? text.length : nextLine;
    if (text.slice(lineStart, start).trim() || text.slice(end, lineEnd).trim()) return;
    const match = IMAGE_TAG.exec(node.value);
    if (!match) return;
    candidates.push({ start, end, path: decodeAttachmentAttribute(match[1]!) });
  });
  return candidates;
}

function ownedImage(path: string, attachmentsDir: string): TurnImageInput | typeof UNREADABLE | null {
  if (!path || path.includes("\0")) return null;
  const name = path.split(/[\\/]/).at(-1) ?? "";
  if (!OWNED_IMAGE_NAME.test(name)) return null;

  // A basename match alone would let any /tmp/<uuid>.png pose as an app attachment: the path must point into this store.
  const expected = resolve(attachmentsDir, name);
  if (resolve(path) !== expected) return null;

  try {
    const entry = lstatSync(expected);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size <= 0 || entry.size > IMAGE_MAX_BYTES) return null;
    const canonicalRoot = realpathSync(attachmentsDir);
    const canonicalFile = realpathSync(expected);
    if (dirname(canonicalFile) !== canonicalRoot) return null;
    const finalEntry = statSync(canonicalFile);
    if (!finalEntry.isFile() || finalEntry.size !== entry.size) return null;
    if (!MIME_BY_EXTENSION[extname(name)]) return null;
    // the bytes say what the picture is; a file stored before uploads were checked may be no picture at all
    const mime = imageMimeOf(headOf(canonicalFile)) as TurnImageInput["mime"] | null;
    return mime ? { path: expected, mime, bytes: entry.size } : UNREADABLE;
  } catch {
    return null;
  }
}

export interface ExtractTurnImagesOptions {
  attachmentsDir?: string;
  maxCount?: number;
  maxBytes?: number;
  /** Leave every picture out, each with the unreadable note: after an engine refused one it cannot name. */
  withoutImages?: boolean;
}

/** Invalid tags stay visible as ordinary text and never become native image input. */
export function extractTurnImages(
  text: string,
  options: ExtractTurnImagesOptions = {},
): { text: string; images: TurnImageInput[] } {
  if (!text.includes("<attached-image")) return { text, images: [] };

  const attachmentsDir = options.attachmentsDir ?? ATTACHMENTS_DIR;
  const maxCount = options.maxCount ?? TURN_IMAGE_MAX_COUNT;
  const maxBytes = options.maxBytes ?? TURN_IMAGE_MAX_BYTES;
  const owned = imageTagCandidates(text).map((tag) => ({ tag, image: ownedImage(tag.path, attachmentsDir) }));
  const unreadable = owned.flatMap((item) => item.image === UNREADABLE || (item.image !== null && options.withoutImages) ? [item.tag] : []);
  const admitted = owned.filter((item): item is { tag: TagCandidate; image: TurnImageInput } =>
    item.image !== null && item.image !== UNREADABLE && !options.withoutImages);

  if (admitted.length > maxCount) {
    throw statusError(413, `Send no more than ${maxCount} images at a time`);
  }
  const aggregateBytes = admitted.reduce((total, item) => total + item.image.bytes, 0);
  if (aggregateBytes > maxBytes) {
    throw statusError(413, `Attached images exceed ${Math.floor(maxBytes / (1024 * 1024))} MB total`);
  }

  let providerText = text;
  const removed = [...admitted.map(({ tag }) => ({ tag, note: "" })), ...unreadable.map((tag) => ({ tag, note: UNREADABLE_IMAGE_NOTE }))];
  for (const { tag, note } of removed.sort((a, b) => b.tag.start - a.tag.start)) {
    providerText = providerText.slice(0, tag.start) + note + providerText.slice(tag.end);
  }
  return { text: providerText, images: admitted.map((item) => item.image) };
}

export function extractSteerImages(
  texts: readonly string[],
  options: ExtractTurnImagesOptions = {},
): { texts: string[]; images: TurnImageInput[] } | null {
  const maxCount = options.maxCount ?? TURN_IMAGE_MAX_COUNT;
  const maxBytes = options.maxBytes ?? TURN_IMAGE_MAX_BYTES;
  const resolved: string[] = [];
  const images: TurnImageInput[] = [];
  try {
    for (const text of texts) {
      const item = extractTurnImages(text, options);
      resolved.push(item.text);
      images.push(...item.images);
    }
  } catch {
    return null;
  }
  if (images.length > maxCount) return null;
  if (images.reduce((total, image) => total + image.bytes, 0) > maxBytes) return null;
  return { texts: resolved, images };
}

export function extractReplayImages<T extends { role: "user" | "assistant"; text: string }>(
  transcript: readonly T[],
  current: readonly TurnImageInput[],
  options: ExtractTurnImagesOptions = {},
): { transcript: T[]; images: TurnImageInput[] } {
  let maxCount = (options.maxCount ?? TURN_IMAGE_MAX_COUNT) - current.length;
  let maxBytes = (options.maxBytes ?? TURN_IMAGE_MAX_BYTES) - current.reduce((total, image) => total + image.bytes, 0);
  const replayed = [...transcript];
  const images: TurnImageInput[] = [];
  for (let index = replayed.length - 1; index >= 0 && maxCount > 0; index -= 1) {
    const entry = replayed[index]!;
    if (entry.role !== "user") continue;
    const item = extractTurnImages(entry.text, { ...options, maxCount: Infinity, maxBytes: Infinity });
    if (!item.images.length) {
      if (item.text !== entry.text) replayed[index] = { ...entry, text: item.text };
      continue;
    }
    const bytes = item.images.reduce((total, image) => total + image.bytes, 0);
    if (item.images.length > maxCount || bytes > maxBytes) break;
    replayed[index] = { ...entry, text: item.text };
    images.unshift(...item.images);
    maxCount -= item.images.length;
    maxBytes -= bytes;
  }
  return { transcript: replayed, images };
}
