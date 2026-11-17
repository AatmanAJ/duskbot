import { useState, type ReactNode } from "react";

import type { DemoReplayRun } from "../../shared/demo-recording";
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleDashed, Loader2, Minus } from "../icons";
import { cn } from "@/lib/cn";
import { demos } from "@/lib/demo-recorder";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { mdPrimaryCls, mdSecondaryCls } from "./ui/GrokDialog";

export const dockCls = "relative z-30 m-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] bg-menu px-3 py-2.5 shadow-lg outline-1 -outline-offset-1 outline-edge [outline-style:solid]";
export const dockTitleCls = "m-0 truncate text-[13px] font-semibold leading-[18px] text-ink";
export const dockLineCls = "m-0 truncate text-[12px] leading-4 text-ink-secondary";
export const quietButton = "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink-secondary hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:opacity-40";

export type DockTone = "watching" | "working" | "done" | "look" | "idle";

export function Mark({ tone, children }: { tone: DockTone; children: ReactNode }) {
  const wash = tone === "watching" ? "bg-danger/12" : tone === "done" ? "bg-success/15" : tone === "look" ? "bg-warning/15" : tone === "idle" ? "bg-ink/6" : "bg-accent/12";
  return <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-[11px]", wash)}>{children}</span>;
}

const count = (key: "showOnce.run.byBot" | "showOnce.run.doneWithFailed", n: number, more: Record<string, string | number> = {}) =>
  t(`${key}.${n === 1 ? "one" : "many"}` as LocaleKey, { count: n, ...more });

const ROW_STATUS: Record<DemoReplayRun["items"][number]["status"], LocaleKey> = { waiting: "showOnce.run.status.waiting", running: "showOnce.run.status.running", done: "showOnce.run.status.done", failed: "showOnce.run.status.failed", skipped: "showOnce.run.status.skipped" };
const SEGMENT: Record<DemoReplayRun["items"][number]["status"], string> = { waiting: "bg-ink/10", running: "bg-accent", done: "bg-success", failed: "bg-warning", skipped: "bg-ink/25" };

function RunRow({ item, botName }: { item: DemoReplayRun["items"][number]; botName: string }) {
  const icon: ReactNode = item.status === "done" ? <CircleCheck size={14} className="text-success" />
    : item.status === "failed" ? <CircleAlert size={14} className="text-warning" />
    : item.status === "running" ? <Loader2 size={14} className="animate-spin text-ink" />
    : item.status === "skipped" ? <Minus size={14} className="text-ink-secondary" />
    : <CircleDashed size={14} className="text-ink-tertiary" />;
  const detail = item.status === "skipped" && item.missing.length ? t("showOnce.run.missing", { names: item.missing.join(", ") })
    : item.status === "failed" ? [item.step, item.note].filter(Boolean).join(": ")
    : item.status === "running" ? item.step ?? ""
    : item.byBot > 0 ? count("showOnce.run.byBot", item.byBot, { name: botName }) : "";
  return (
    <li data-demo-run-item={item.status} className="flex items-start gap-2 py-1">
      <span aria-hidden="true" className="mt-0.5 shrink-0">{icon}</span>
      <span className="w-48 shrink-0 truncate text-[12px] leading-[18px] text-ink" title={item.label}>{item.label}</span>
      <span className="sr-only">{t(ROW_STATUS[item.status])}</span>
      <span className="min-w-0 flex-1 break-words text-[12px] leading-[18px] text-ink-secondary">{detail}</span>
    </li>
  );
}

/** How a run stands, for the frame around the screen it runs on. */
export const runTone = (run: DemoReplayRun): DockTone => (run.status === "running" ? (run.asking ? "look" : "working") : run.failed || run.status === "stopped" || run.items.some((item) => item.status === "skipped" && item.missing.length > 0) ? "look" : "done");

/**
 * A replay as it goes: one mark for each file, what it is on, and each file's outcome on request. When a file's step
 * does not pass the run waits here to be told to leave that file or try the step again; `holding` says the person has
 * the screen, where the bot cannot try anything.
 */
export function DemoRun({ run, botName, holding, onDismiss }: { run: DemoReplayRun; botName: string; holding: boolean; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const total = run.items.length;
  const settled = run.items.filter((item) => item.status === "done" || item.status === "failed" || item.status === "skipped").length;
  const current = run.items.find((item) => item.status === "running");
  const running = run.status === "running";
  const asking = running && run.asking ? run.asking : null;
  const failed = run.failed + run.items.filter((item) => item.status === "skipped" && item.missing.length > 0).length;
  const headline = running ? t("showOnce.run.progress", { done: Math.min(total, settled + (current ? 1 : 0)), total })
    : run.status === "stopped" ? t("showOnce.run.stopped", { done: run.done, total })
    : failed ? count("showOnce.run.doneWithFailed", failed, { done: run.done, total }) : t("showOnce.run.done", { done: run.done, total });
  const tone = runTone(run);
  const send = (work: () => Promise<unknown>) => { setBusy(true); void work().catch(() => {}).finally(() => setBusy(false)); };
  return (
    <div data-demo-run={asking ? "asking" : run.status} className={cn(dockCls, "flex-col items-stretch", asking && "outline-warning")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Mark tone={tone}>{asking || tone === "look" ? <CircleAlert size={16} className="text-warning" /> : running ? <Loader2 size={16} className="animate-spin text-accent-text" /> : <CircleCheck size={16} className="text-success" />}</Mark>
        <div className="min-w-0 flex-1 basis-40">
          <p role="status" className={dockTitleCls}>{asking ? t("showOnce.stuck.title", { name: botName }) : `${running ? `${t("showOnce.run.title", { name: botName })} · ` : ""}${headline}`}</p>
          {current ? <p className={dockLineCls}>{[asking ? headline : "", current.label, asking ? asking.step : current.step].filter(Boolean).join(" · ")}</p> : null}
        </div>
        {asking ? <>
          <button type="button" className={quietButton} disabled={busy} onClick={() => send(() => demos.decide(run.recordingId, "skip"))}>{t("showOnce.stuck.skip")}</button>
          <button type="button" data-demo-retry className={mdPrimaryCls} disabled={busy || holding} title={holding ? t("showOnce.holdHint", { name: botName }) : undefined} onClick={() => send(() => demos.decide(run.recordingId, "retry"))}>{t("showOnce.stuck.retry")}</button>
        </> : <>
          <button type="button" className={quietButton} aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? "showOnce.run.hide" : "showOnce.run.details")}{open ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}</button>
          {running
            ? <button type="button" className={mdSecondaryCls} disabled={busy} onClick={() => send(() => demos.stopReplay(run.recordingId))}>{t("showOnce.run.stop")}</button>
            : <button type="button" className={mdPrimaryCls} onClick={onDismiss}>{t("common.close")}</button>}
        </>}
      </div>
      {asking ? <p data-demo-stuck className="m-0 rounded-[11px] bg-warning/12 px-3 py-2 text-[12px] leading-[17px] text-ink">{asking.note ? `${asking.note} ` : ""}{t("showOnce.stuck.hint", { name: botName })}</p> : null}
      <div aria-hidden="true" data-demo-run-marks className="flex gap-1">{run.items.map((item) => <span key={item.id} className={cn("h-1.5 min-w-1 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none", asking?.item === item.id ? "bg-warning" : SEGMENT[item.status])} />)}</div>
      {open && !asking && <ul className="m-0 max-h-56 list-none overflow-y-auto p-0 [scrollbar-width:thin]">{run.items.map((item) => <RunRow key={item.id} item={item} botName={botName} />)}</ul>}
    </div>
  );
}
