import { useState } from "react";

import type { DemoPlan, DemoReplayItem } from "../../shared/demo-recording";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { GrokDialog, mdPrimaryCls, mdSecondaryCls, rowHintCls } from "./ui/GrokDialog";

const many = (key: "showOnce.files.title" | "showOnce.files.ready" | "showOnce.files.lacking", n: number, more: Record<string, string | number> = {}) =>
  t(`${key}.${n === 1 ? "one" : "many"}` as LocaleKey, { count: n, ...more });

/**
 * What was read out of each file, before anything is done with it: one row for a file, one column for an input. A value
 * can be put right here; a row that still lacks one is left out of the run, and said to be.
 */
export function DemoFiles({ plan, read, left, onRun, onCancel }: { plan: DemoPlan; read: DemoReplayItem[]; left: string[]; onRun: (items: DemoReplayItem[]) => void; onCancel: () => void }) {
  const [items, setItems] = useState(read);
  const columns = plan.blanks.filter((blank) => blank.kind !== "secret" && !blank.today);
  const lacks = (item: DemoReplayItem) => columns.filter((blank) => !(item.values[blank.name] ?? "").trim()).map((blank) => blank.name);
  const ready = items.filter((item) => lacks(item).length === 0);
  const lacking = items.length - ready.length;
  const write = (id: string, name: string, value: string) => setItems((now) => now.map((item) => (item.id === id ? { ...item, values: { ...item.values, [name]: value } } : item)));
  const start = () => onRun(ready.map((item) => ({ ...item, missing: [] })));
  return (
    <GrokDialog
      title={many("showOnce.files.title", items.length, { title: plan.title })}
      width={Math.min(980, 300 + columns.length * 150)}
      onClose={onCancel}
      data-panel-modal="demo-files"
      footer={<>
        <p role="status" className="m-0 mr-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-secondary">
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-success" />{many("showOnce.files.ready", ready.length)}</span>
          {lacking > 0 ? <span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 rounded-full bg-warning" />{many("showOnce.files.lacking", lacking)}</span> : null}
        </p>
        <button type="button" className={mdSecondaryCls} onClick={onCancel}>{t("common.cancel")}</button>
        <button type="button" data-demo-files-run className={mdPrimaryCls} disabled={ready.length === 0} onClick={start}>{lacking > 0 ? t("showOnce.files.runSome", { ready: ready.length, lacking }) : t("showOnce.files.runAll", { ready: ready.length })}</button>
      </>}
    >
      <div className="flex flex-col gap-3" data-demo-files>
        <p className={cn(rowHintCls, "m-0")}>{t("showOnce.files.hint")}{left.length ? ` ${t("showOnce.files.left", { names: left.join(", ") })}` : ""}</p>
        <div className="overflow-x-auto [scrollbar-width:thin]">
          <table className="w-full border-collapse text-left text-[13px] leading-[18px] text-ink">
            <thead>
              <tr className="border-b border-ink/8">
                <th scope="col" className="py-2 pr-3 text-[12px] font-normal text-ink-secondary">{t("showOnce.files.file")}</th>
                {columns.map((blank) => <th key={blank.name} scope="col" className="min-w-28 px-1 py-2 font-mono text-[12px] font-normal text-accent-text">{blank.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const missing = lacks(item);
                return (
                  <tr key={item.id} data-demo-file={missing.length ? "lacking" : "ready"} className="border-b border-ink/5 last:border-b-0">
                    <th scope="row" className="max-w-48 truncate py-1.5 pr-3 font-mono text-[12px] font-normal text-ink-secondary" title={item.label}>{item.label}</th>
                    {columns.map((blank) => (
                      <td key={blank.name} className="px-1 py-1">
                        <input
                          value={item.values[blank.name] ?? ""}
                          aria-label={t("showOnce.files.cell", { name: blank.name, file: item.label })}
                          aria-invalid={missing.includes(blank.name) || undefined}
                          placeholder={missing.includes(blank.name) ? t("showOnce.files.missing") : undefined}
                          onChange={(event) => write(item.id, blank.name, event.target.value)}
                          className={cn("block h-8 w-full min-w-0 rounded-[8px] border bg-transparent px-2 text-[13px] text-ink outline-none placeholder:text-ink-tertiary hover:bg-ink/4 focus:bg-ink/6", missing.includes(blank.name) ? "border-warning bg-warning/10" : "border-transparent")}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </GrokDialog>
  );
}
