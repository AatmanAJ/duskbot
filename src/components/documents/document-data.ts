import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  documentFileName, parseSheet, sheetExportCsv, type ChatDocumentCard, type DocumentKind, type DocumentMeta, type DocumentWithContent,
} from "../../../shared/documents";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { visibleMessages, type Bot } from "@/state/store";

export type { ChatDocumentCard, DocumentKind, DocumentMeta, DocumentWithContent };

const base = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/documents`;

export const documentApi = {
  list: (botId: string) => api<{ documents: DocumentMeta[] }>(base(botId)).then((answer) => answer.documents),
  get: (botId: string, id: string) => api<DocumentWithContent>(`${base(botId)}/${id}`),
  save: (botId: string, id: string, change: { title?: string; content?: string; expectedVersion?: number }) =>
    api<DocumentWithContent>(`${base(botId)}/${id}`, { method: "PATCH", body: JSON.stringify(change) }),
  restore: (botId: string, id: string, version: number) =>
    api<DocumentWithContent>(`${base(botId)}/${id}/restore`, { method: "POST", body: JSON.stringify({ version }) }),
  remove: (botId: string, id: string) => api(`${base(botId)}/${id}`, { method: "DELETE" }),
};

/** The file glyph's name for a kind: Markdown and pages read as a written page, a sheet as a spreadsheet. */
export const glyphName = (kind: DocumentKind) => (kind === "sheet" ? "sheet.csv" : "page.md");

export function kindLabel(kind: DocumentKind): string {
  return t(kind === "sheet" ? "documents.kind.sheet" : kind === "html" ? "documents.kind.html" : "documents.kind.markdown");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return t("documents.size.bytes", { n: bytes });
  const kb = bytes / 1024;
  return t("documents.size.kb", { n: kb < 10 ? kb.toFixed(1) : Math.round(kb) });
}

/** "Sheet · 24 rows · 5 columns", "Document · 3.2 KB". */
export function documentShapeLine(doc: Pick<DocumentMeta, "kind" | "bytes" | "rows" | "columns">): string {
  if (doc.kind === "sheet" && doc.rows !== undefined) {
    return [kindLabel(doc.kind), t(doc.rows === 1 ? "documents.rows.one" : "documents.rows", { n: doc.rows.toLocaleString() }),
      t(doc.columns === 1 ? "documents.columns.one" : "documents.columns", { n: (doc.columns ?? 0).toLocaleString() })].join(" · ");
  }
  return `${kindLabel(doc.kind)} · ${formatBytes(doc.bytes)}`;
}

/** Saves the document to the computer as a file: Markdown, CSV (formulas quoted as text) or HTML. */
export function downloadDocument(doc: Pick<DocumentWithContent, "title" | "kind" | "content">): void {
  const body = doc.kind === "sheet" ? ["﻿", sheetExportCsv(parseSheet(doc.content))] : [doc.content];
  const type = doc.kind === "sheet" ? "text/csv;charset=utf-8" : doc.kind === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8";
  const url = URL.createObjectURL(new Blob(body, { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = documentFileName(doc.title, doc.kind);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The newest document card in the open conversation, as `id:version`: the Files list reads again when it changes. */
export function latestCardKey(bot: Bot): string {
  const messages = visibleMessages(bot);
  for (let index = messages.length - 1; index >= 0; index--) {
    const card = messages[index]!.document;
    if (card) return `${card.id}:${card.version}`;
  }
  return "";
}

export function useBotDocuments(bot: Bot) {
  const [documents, setDocuments] = useState<DocumentMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const key = useMemo(() => latestCardKey(bot), [bot]);
  const reload = useCallback(() => {
    let live = true;
    documentApi.list(bot.id)
      .then((list) => { if (live) { setDocuments(list); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [bot.id]);
  useEffect(() => reload(), [reload, key]);
  return { documents, failed, reload, setDocuments };
}

/** Which document the panel's file page shows. */
let opened: { botId: string; id: string } | null = null;
const watchers = new Set<() => void>();

export function setOpenDocument(next: { botId: string; id: string }): void {
  opened = next;
  for (const watch of Array.from(watchers)) watch();
}

export function useOpenDocument(): { botId: string; id: string } | null {
  return useSyncExternalStore(
    (watch) => { watchers.add(watch); return () => { watchers.delete(watch); }; },
    () => opened,
    () => opened,
  );
}
