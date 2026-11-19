import { Check, Copy } from "../../icons";
import type { TableCell, TableColumn } from "@/components/RichTable";
import { useCopyFeedback } from "@/lib/copy-text";
import { tableCsv } from "@/lib/table-data";
import { t } from "@/lib/i18n";
import { RoundButton } from "../RoundButton";
import { Sheet } from "../Sheet";
import { ViewerNote } from "./ViewerNote";

/** A reply's table full screen: it scrolls both ways under a header row and a first column that stay put. */
export function TableViewer({ columns, rows, name, open, onClose }: { columns: TableColumn[]; rows: TableCell[][]; name: string; open: boolean; onClose: () => void }) {
  const { state: copied, copy } = useCopyFeedback(tableCsv(columns.map((column) => column.text), rows.map((row) => row.map((cell) => cell.text))));
  return (
    <Sheet open={open} onClose={onClose} full label={name}
      title={<span className="flex items-baseline gap-2">{name}<span className="text-[13px] font-normal text-ink-tertiary tabular-nums">{t(rows.length === 1 ? "mobile.table.rows.one" : "mobile.table.rows", { count: rows.length })}</span></span>}
      trailing={<RoundButton label={copied === "copied" ? t("table.copied") : t("table.copyPlain")} onClick={copy}>
        {copied === "copied" ? <Check size={18} className="text-success" /> : <Copy size={18} />}
      </RoundButton>}
      bodyClassName="!overflow-hidden flex flex-col !pb-0">
      <div data-table-viewer="" tabIndex={0} role="region" aria-label={name} className="table-viewer min-h-0 flex-1 overflow-auto overscroll-contain pb-[max(var(--m-safe-bottom),16px)] focus-visible:outline-none">
        <table className="min-w-full border-separate border-spacing-0 text-[15px] leading-[1.45]">
          <thead><tr>{columns.map((column, index) => <th key={index} scope="col" className="whitespace-nowrap px-4 py-2.5 text-start font-semibold" style={{ textAlign: column.align as "left" | undefined }}>{column.content ?? column.text}</th>)}</tr></thead>
          <tbody>{rows.map((row, r) => <tr key={r}>{columns.map((column, c) => {
            const cell = row[c];
            return <td key={c} className="px-4 py-2.5 align-top tabular-nums" style={{ textAlign: (cell?.align ?? column.align) as "left" | undefined }}>
              <div dir="auto" className="w-max max-w-[16rem] whitespace-pre-wrap break-words">{cell?.content ?? cell?.text}</div>
            </td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <ViewerNote show={copied !== "idle"} text={copied === "failed" ? t("table.copyFailed") : t("mobile.viewer.copied")} failed={copied === "failed"} />
    </Sheet>
  );
}
