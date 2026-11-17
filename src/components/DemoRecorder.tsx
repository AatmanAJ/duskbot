import { useEffect, useRef, useState, type ReactNode } from "react";

import type { DemoRecording, DemoReplayRun, DemoSurface } from "../../shared/demo-recording";
import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, CircleDashed, Loader2, Minus } from "../icons";
import { cn } from "@/lib/cn";
import { demos, useBotDemos } from "@/lib/demo-recorder";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import type { LocaleKey } from "@/locales";
import { DemoReview } from "./DemoReview";
import { mdPrimaryCls, mdSecondaryCls, rowHintCls, smallButtonCls, textFieldCls } from "./ui/GrokDialog";

export { checkLine, DemoReview } from "./DemoReview";

const count = (key: "showOnce.actions" | "showOnce.run.byBot" | "showOnce.run.doneWithFailed", n: number, more: Record<string, string | number> = {}) =>
  t(`${key}.${n === 1 ? "one" : "many"}` as LocaleKey, { count: n, ...more });
const dockCls = "m-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] bg-menu px-3 py-2.5 shadow-lg outline-1 -outline-offset-1 outline-edge [outline-style:solid]";
const dockTitleCls = "m-0 truncate text-[13px] font-semibold leading-[18px] text-ink";
const dockLineCls = "m-0 truncate text-[12px] leading-4 text-ink-secondary";
const quietButton = "flex h-8 shrink-0 cursor-pointer items-center rounded-full px-3 text-[13px] font-medium text-ink-secondary hover:bg-ink/6 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:opacity-40";

const clock = (ms: number) => { const seconds = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; };

/** How long a showing has run, counted here once a second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return <span className="tabular-nums">{clock(now - since)}</span>;
}

function Mark({ tone, children }: { tone: "watching" | "working" | "done" | "look"; children: ReactNode }) {
  const wash = tone === "watching" ? "bg-danger/12" : tone === "done" ? "bg-success/15" : tone === "look" ? "bg-warning/15" : "bg-accent/12";
  return <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center rounded-[11px]", wash)}>{children}</span>;
}

/** What happens next, said before anything is recorded, with a name for the task if the person has one. */
function DemoIntro({ botName, starting, onStart, onCancel }: { botName: string; starting: boolean; onStart: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const promises: LocaleKey[] = ["showOnce.intro.steps", "showOnce.intro.secrets", "showOnce.intro.review"];
  return (
    <form data-demo-intro className={cn(dockCls, "max-w-[460px] flex-col items-stretch gap-3 p-4")} onSubmit={(event) => { event.preventDefault(); onStart(name); }}>
      <div className="flex flex-col gap-1">
        <h3 className="m-0 text-[14px] font-semibold leading-5 text-ink">{t("showOnce.recordTitle", { name: botName })}</h3>
        <p className={cn(rowHintCls, "m-0")}>{t("showOnce.recordHint", { name: botName })}</p>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] leading-4 text-ink-secondary">{t("showOnce.intro.name")}</span>
        <input autoFocus value={name} placeholder={t("showOnce.intro.namePlaceholder")} onChange={(event) => setName(event.target.value)} className={cn(textFieldCls, "bg-ink/4")} />
      </label>
      <ul className="m-0 flex list-none flex-col gap-1.5 rounded-[11px] bg-ink/4 p-3">
        {promises.map((key) => <li key={key} className="flex items-start gap-2 text-[12px] leading-[17px] text-ink"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />{t(key)}</li>)}
      </ul>
      <div className="flex justify-end gap-2">
        <button type="button" className={mdSecondaryCls} onClick={onCancel}>{t("showOnce.intro.notNow")}</button>
        <button type="submit" data-demo-start className={mdPrimaryCls} disabled={starting}>{starting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{t("showOnce.intro.start")}</button>
      </div>
    </form>
  );
}

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

/** A replay as it goes: one mark for each file, what it is on, and each file's outcome on request. */
export function DemoRun({ run, botName, onDismiss }: { run: DemoReplayRun; botName: string; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const total = run.items.length;
  const settled = run.items.filter((item) => item.status === "done" || item.status === "failed" || item.status === "skipped").length;
  const current = run.items.find((item) => item.status === "running");
  const running = run.status === "running";
  const failed = run.failed + run.items.filter((item) => item.status === "skipped" && item.missing.length > 0).length;
  const headline = running ? t("showOnce.run.progress", { done: Math.min(total, settled + (current ? 1 : 0)), total })
    : run.status === "stopped" ? t("showOnce.run.stopped", { done: run.done, total })
    : failed ? count("showOnce.run.doneWithFailed", failed, { done: run.done, total }) : t("showOnce.run.done", { done: run.done, total });
  const tone = running ? "working" : failed || run.status === "stopped" ? "look" : "done";
  return (
    <div data-demo-run={run.status} className={cn(dockCls, "flex-col items-stretch")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Mark tone={tone}>{running ? <Loader2 size={16} className="animate-spin text-accent-text" /> : tone === "look" ? <CircleAlert size={16} className="text-warning" /> : <CircleCheck size={16} className="text-success" />}</Mark>
        <div className="min-w-0 flex-1 basis-40">
          <p role="status" className={dockTitleCls}>{running ? t("showOnce.run.title", { name: botName }) : ""}{running ? " · " : ""}{headline}</p>
          {current ? <p className={dockLineCls}>{[current.label, current.step].filter(Boolean).join(" · ")}</p> : null}
        </div>
        <button type="button" className={quietButton} aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? "showOnce.run.hide" : "showOnce.run.details")}{open ? <ChevronUp size={12} aria-hidden="true" className="ml-1" /> : <ChevronDown size={12} aria-hidden="true" className="ml-1" />}</button>
        {running
          ? <button type="button" className={mdSecondaryCls} disabled={stopping} onClick={() => { setStopping(true); void demos.stopReplay(run.recordingId).catch(() => {}).finally(() => setStopping(false)); }}>{t("showOnce.run.stop")}</button>
          : <button type="button" className={mdPrimaryCls} onClick={onDismiss}>{t("common.close")}</button>}
      </div>
      <div aria-hidden="true" data-demo-run-marks className="flex gap-1">{run.items.map((item) => <span key={item.id} className={cn("h-1.5 min-w-1 flex-1 rounded-full transition-colors duration-300 motion-reduce:transition-none", SEGMENT[item.status])} />)}</div>
      {open && <ul className="m-0 max-h-56 list-none overflow-y-auto p-0 [scrollbar-width:thin]">{run.items.map((item) => <RunRow key={item.id} item={item} botName={botName} />)}</ul>}
    </div>
  );
}

const TAKE_TIMEOUT_MS = 12_000;

/**
 * Show it once, on one of a bot's screens: what it is before it starts, the showing while the person holds the screen,
 * the steps to review when they stop, and the replay as it runs. `holding` says the person has taken control here;
 * `onTake` takes it and keeps it, which starting does first so the screen stays theirs for as long as they are showing
 * the task. A change of `asked` opens the start from elsewhere, such as a menu.
 */
export function DemoRecorder({ bot, surface, holding, threadId, onTake, asked = 0 }: { bot: { id: string; name: string }; surface: DemoSurface; holding: boolean; threadId?: string; onTake?: () => void; asked?: number }) {
  const state = useBotDemos(bot.id);
  const [intro, setIntro] = useState(false);
  const [taking, setTaking] = useState(false);
  const heard = useRef(asked);
  const named = useRef("");
  const [names, setNames] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState<string | null>(null);

  const live = state.recordings.find((recording) => recording.status === "recording" || recording.status === "compiling");
  const ready = state.recordings.filter((recording) => recording.status === "ready" && recording.plan);
  const run = Object.values(state.runs).find((each) => each.id !== dismissed && ready.some((recording) => recording.id === each.recordingId));
  const review = reviewing ? ready.find((recording) => recording.id === reviewing) : undefined;
  const offered = Boolean(state.surfaces[surface]) && !live;

  const act = async (work: () => Promise<DemoRecording | void>): Promise<DemoRecording | void> => {
    setBusy(true);
    setError("");
    try { return await work(); } catch (cause) { setError(friendlyError(cause)); } finally { setBusy(false); }
  };
  const begin = (name: string) => {
    if (live || taking || !state.surfaces[surface]) return;
    named.current = name.trim();
    setError("");
    onTake?.();
    setTaking(true);
  };
  useEffect(() => {
    if (!taking) return;
    if (holding) {
      setTaking(false);
      setIntro(false);
      void act(async () => {
        const started = await demos.start(bot.id, surface, threadId);
        if (named.current) setNames((now) => ({ ...now, [started.id]: named.current }));
        return started;
      });
      return;
    }
    const late = setTimeout(() => { setTaking(false); setError(t("showOnce.takeFailed")); }, TAKE_TIMEOUT_MS);
    return () => clearTimeout(late);
  }, [taking, holding]);
  useEffect(() => {
    if (asked === heard.current) return;
    heard.current = asked;
    if (!live && state.surfaces[surface]) setIntro(true);
  }, [asked]);
  const stop = async () => {
    const stopped = await act(() => demos.stop(bot.id));
    if (!stopped) return;
    if (stopped.status === "ready") setReviewing(stopped.id);
    else setError(stopped.error ? t("showOnce.failedWhy", { why: stopped.error }) : t("showOnce.failed"));
  };

  if (!state.loaded || (!state.surfaces[surface] && !ready.length && !live)) return null;
  if (!offered && !taking && !intro && !live && !run && !ready.length && !error) return null;

  const title = live ? names[live.id] : "";
  return (
    <div data-demo-recorder={live?.status ?? (run ? "replay" : intro ? "intro" : "idle")} className={cn("shrink-0", (live || run || intro) && "order-last")}>
      {run ? <DemoRun run={run} botName={bot.name} onDismiss={() => setDismissed(run.id)} />
        : live?.status === "recording" ? (
          <div data-demo-dock="watching" className={dockCls}>
            <Mark tone="watching"><span className="size-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" /></Mark>
            <div className="min-w-0 flex-1 basis-40">
              <p role="status" className={dockTitleCls}>{t("showOnce.recording", { name: bot.name })}</p>
              <p className={dockLineCls}>{title ? `${title} · ` : ""}<span data-demo-actions>{count("showOnce.actions", live.eventCount)}</span> · <Elapsed since={live.createdAt} /></p>
            </div>
            <button type="button" className={quietButton} disabled={busy} onClick={() => void act(() => demos.cancel(bot.id))}>{t("showOnce.discard")}</button>
            <button type="button" data-demo-stop className={mdPrimaryCls} disabled={busy} onClick={() => void stop()}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{t("showOnce.stop")}</button>
          </div>
        ) : live ? (
          <div data-demo-dock="writing" className={dockCls}>
            <Mark tone="working"><Loader2 size={16} className="animate-spin text-accent-text" /></Mark>
            <div className="min-w-0 flex-1 basis-40">
              <p role="status" className={dockTitleCls}>{t("showOnce.compiling", { name: bot.name })}</p>
              <p className={dockLineCls}>{count("showOnce.actions", live.eventCount)}</p>
            </div>
          </div>
        ) : intro ? <DemoIntro botName={bot.name} starting={taking || busy} onStart={begin} onCancel={() => { setIntro(false); setTaking(false); }} />
        : (
          <div className="flex min-h-9 items-center gap-2 px-3 py-1">
            {offered ? (
              <button type="button" data-demo-record className={cn(smallButtonCls, "bg-ink text-app enabled:hover:bg-ink/85")} disabled={busy} onClick={() => setIntro(true)}>
                <span aria-hidden="true" className="size-2 rounded-full bg-danger" />{t("showOnce.record", { name: bot.name })}
              </button>
            ) : null}
            <span className="min-w-0 flex-1" />
            {ready.length > 0 && (
              <button type="button" className={smallButtonCls} aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>{t("showOnce.shown", { count: ready.length })}{listOpen ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}</button>
            )}
          </div>
        )}
      {error && <p role="alert" className="m-0 px-3 pb-1.5 text-[12px] leading-4 text-danger">{error}</p>}
      {listOpen && !run && !live && !intro && ready.length > 0 && (
        <ul className="m-0 flex max-h-48 list-none flex-col overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
          {ready.map((recording) => (
            <li key={recording.id}>
              <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-ink/6 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" onClick={() => { setReviewing(recording.id); setListOpen(false); }}>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{recording.plan!.title}</span>
                <span className="shrink-0 text-[12px] text-ink-secondary">{recording.skillName ? t("showOnce.savedAs", { name: recording.skillName }) : t("showOnce.notSaved")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {review && <DemoReview key={review.id} recording={review} botName={bot.name} holding={holding} named={names[review.id] ?? ""} onClose={() => setReviewing(null)} />}
    </div>
  );
}
