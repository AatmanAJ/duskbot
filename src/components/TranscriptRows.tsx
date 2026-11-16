import { useVirtualizer } from "@tanstack/react-virtual";
import { cloneElement, createContext, isValidElement, use, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react";

/** From this many drawn rows a transcript mounts only the rows near the viewport; a shorter one draws every row. */
export const VIRTUAL_TRANSCRIPT_FROM = 120;
const OVERSCAN_ROWS = 8;

export interface TranscriptViewport {
  scrollRef: RefObject<HTMLElement | null>;
  /** The transcript column, which the arrival glide translates; offsets are read without that translation. */
  columnRef: RefObject<HTMLElement | null>;
  /** Changes when another thread is shown: positions and sizes start over. */
  transcriptKey: string;
  /** The transcript opens at its newest row. */
  startAtEnd: boolean;
  /** A message a search or link is landing on: its row is brought into view so it can be found and lit. */
  focusMessageId: string | null;
  /** Messages whose rows stay mounted, hidden, while scrolled away: a bubble being edited keeps its draft. */
  keepMounted: readonly string[];
}

export const TranscriptViewportContext = createContext<TranscriptViewport | null>(null);

/** One transcript row: the `contents` wrapper a list draws, the messages it shows, and a guess at its height. */
export interface TranscriptRow {
  element: ReactNode;
  messageIds: readonly string[];
  estimate: number;
}

type RowElement = ReactElement<{ className?: string; style?: CSSProperties; "data-index"?: number; ref?: unknown }>;
type DrawnRow = TranscriptRow & { element: RowElement };

export function TranscriptRows({ rows }: { rows: readonly TranscriptRow[] }): ReactNode {
  const viewport = use(TranscriptViewportContext);
  const drawn = useMemo(() => rows.filter((row): row is DrawnRow => isValidElement(row.element)), [rows]);
  if (!viewport || drawn.length < VIRTUAL_TRANSCRIPT_FROM) return <>{rows.map((row) => row.element)}</>;
  return <VirtualRows key={viewport.transcriptKey} rows={drawn} viewport={viewport} />;
}

const ROW_STYLE: CSSProperties = { display: "flex", flexDirection: "column", gap: "inherit" };
const HIDDEN_ROW_STYLE: CSSProperties = { display: "none" };

/** The column's translation (the arrival glide), so offsets read from it are where the rows rest. */
function translatedBy(element: HTMLElement | null): number {
  if (!element) return 0;
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  try {
    return new DOMMatrixReadOnly(transform).m42;
  } catch {
    return 0;
  }
}

function VirtualRows({ rows, viewport }: { rows: readonly DrawnRow[]; viewport: TranscriptViewport }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ margin: 0, gap: 16 });
  const kept = useMemo(() => {
    if (!viewport.keepMounted.length) return [];
    const ids = new Set(viewport.keepMounted);
    const indexes: number[] = [];
    rows.forEach((row, index) => { if (row.messageIds.some((id) => ids.has(id))) indexes.push(index); });
    return indexes;
  }, [rows, viewport.keepMounted]);
  const keyOf = useCallback((index: number) => String(rows[index]?.element.key ?? index), [rows]);
  const startAtEnd = useRef(viewport.startAtEnd).current;
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => viewport.scrollRef.current,
    estimateSize: (index) => rows[index]?.estimate ?? 80,
    getItemKey: keyOf,
    overscan: OVERSCAN_ROWS,
    gap: geometry.gap,
    scrollMargin: geometry.margin,
    initialOffset: () => (startAtEnd ? Number.MAX_SAFE_INTEGER : 0),
  });

  // Where the list starts inside the scroller and the gap between its rows; both follow the layout around it.
  useLayoutEffect(() => {
    const list = listRef.current, scroller = viewport.scrollRef.current;
    if (!list || !scroller) return;
    const margin = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - translatedBy(viewport.columnRef.current);
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    if (Math.abs(margin - geometry.margin) > 0.5 || gap !== geometry.gap) setGeometry({ margin: Math.round(margin), gap });
  });

  const focusIndex = useMemo(
    () => viewport.focusMessageId ? rows.findIndex((row) => row.messageIds.includes(viewport.focusMessageId!)) : -1,
    [rows, viewport.focusMessageId],
  );
  useLayoutEffect(() => {
    if (focusIndex < 0) return;
    const range = virtualizer.range;
    if (range && focusIndex >= range.startIndex && focusIndex <= range.endIndex) return;
    virtualizer.scrollToIndex(focusIndex, { align: "center" });
  }, [focusIndex, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const first = items[0], last = items.at(-1);
  const margin = virtualizer.options.scrollMargin;
  const paddingTop = first ? Math.max(0, first.start - margin) : 0;
  const paddingBottom = last ? Math.max(0, virtualizer.getTotalSize() - (last.end - margin)) : 0;
  const shown = new Set(items.map((item) => item.index));
  const hiddenBefore = kept.filter((index) => !shown.has(index) && first !== undefined && index < first.index);
  const hiddenAfter = kept.filter((index) => !shown.has(index) && (first === undefined || index > first.index));
  const hidden = (index: number) => cloneElement(rows[index]!.element, { style: HIDDEN_ROW_STYLE, "data-index": index });

  return (
    <div ref={listRef} data-virtual-rows="" style={{ display: "flex", flexDirection: "column", gap: "inherit", paddingTop, paddingBottom }}>
      {hiddenBefore.map(hidden)}
      {items.map((item) => cloneElement(rows[item.index]!.element, { ref: virtualizer.measureElement, "data-index": item.index, className: undefined, style: ROW_STYLE }))}
      {hiddenAfter.map(hidden)}
    </div>
  );
}
