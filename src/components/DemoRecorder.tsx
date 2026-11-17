import { useEffect, useRef, useState } from "react";

import type { DemoRecording, DemoSeeing, DemoSurface } from "../../shared/demo-recording";
import { ChevronDown, ChevronUp, Loader2, LockKeyhole, Pause, Play, Undo2 } from "../icons";
import { cn } from "@/lib/cn";
import { demos, useBotDemos } from "@/lib/demo-recorder";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import type { LocaleKey } from "@/locales";
import { DemoReview } from "./DemoReview";
import { DemoRun, dockCls, dockLineCls, dockTitleCls, Mark, quietButton, runTone, type DockTone } from "./DemoRun";
import { mdPrimaryCls, mdSecondaryCls, rowHintCls, smallButtonCls, textFieldCls } from "./ui/GrokDialog";

export { checkLine, DemoReview } from "./DemoReview";
export { DemoRun } from "./DemoRun";

const actions = (n: number) => t(`showOnce.actions.${n === 1 ? "one" : "many"}` as LocaleKey, { count: n });
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

const SEEN: Partial<Record<DemoSeeing["kind"], [named: LocaleKey, bare: LocaleKey]>> = {
  type: ["showOnce.seeing.type", "showOnce.seeing.typeBare"],
  click: ["showOnce.seeing.click", "showOnce.seeing.clickBare"],
  "double-click": ["showOnce.seeing.click", "showOnce.seeing.clickBare"],
  "right-click": ["showOnce.seeing.click", "showOnce.seeing.clickBare"],
  choose: ["showOnce.seeing.choose", "showOnce.seeing.chooseBare"],
};
const SEEN_BARE: Partial<Record<DemoSeeing["kind"], LocaleKey>> = { open: "showOnce.seeing.open", key: "showOnce.seeing.key", scroll: "showOnce.seeing.scroll", drag: "showOnce.seeing.drag" };

/** The last thing the person did, in words. What was typed is never part of it: a secure field gets a count. */
export function seeingLine(seeing: DemoSeeing | undefined): string {
  if (!seeing) return t("showOnce.seeing.nothing");
  if (seeing.kind === "type" && seeing.secure) return seeing.name ? t("showOnce.seeing.secure", { name: seeing.name, count: seeing.chars ?? 0 }) : t("showOnce.seeing.secureBare", { count: seeing.chars ?? 0 });
  const pair = SEEN[seeing.kind];
  if (pair) return seeing.name ? t(pair[0], { name: seeing.name }) : t(pair[1]);
  return t(SEEN_BARE[seeing.kind] ?? "showOnce.seeing.nothing");
}

const FRAME: Partial<Record<DockTone, string>> = { watching: "inset-ring-danger", working: "inset-ring-accent", look: "inset-ring-warning" };

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

/** The showing under way: what the bot last saw, and taking a step back, pausing, throwing it away or finishing. */
function Watching({ live, botName, title, busy, onUndo, onPause, onDiscard, onDone }: { live: DemoRecording; botName: string; title: string; busy: boolean; onUndo: () => void; onPause: (paused: boolean) => void; onDiscard: () => void; onDone: () => void }) {
  const paused = live.paused === true;
  const away = !paused && live.seeing?.kind === "type" && live.seeing.secure === true;
  return (
    <div data-demo-dock={paused ? "paused" : away ? "away" : "watching"} className={dockCls}>
      <Mark tone={paused ? "idle" : "watching"}>{paused ? <Pause size={14} className="text-ink-secondary" /> : <span className="size-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" />}</Mark>
      <div className="min-w-0 basis-40">
        <p role="status" className={dockTitleCls}>{paused ? t("showOnce.paused") : away ? t("showOnce.away", { name: botName }) : t("showOnce.recording", { name: botName })}</p>
        <p className={dockLineCls}>{title ? `${title} · ` : ""}<span data-demo-actions>{actions(live.eventCount)}</span>{paused ? null : <> · <Elapsed since={live.createdAt} /></>}</p>
      </div>
      <p data-demo-seeing className={cn("m-0 flex h-9 min-w-0 flex-1 basis-48 items-center gap-2 truncate rounded-[11px] px-3 text-[13px]", away ? "bg-ink text-app" : "bg-ink/4 text-ink")}>
        {away ? <LockKeyhole size={13} aria-hidden="true" className="shrink-0" /> : null}
        <span className="truncate">{paused ? t("showOnce.pausedHint") : seeingLine(live.seeing)}</span>
      </p>
      <button type="button" className={quietButton} disabled={busy || paused || live.eventCount === 0} onClick={onUndo}><Undo2 size={13} aria-hidden="true" />{t("showOnce.undo")}</button>
      <button type="button" className={quietButton} disabled={busy} onClick={() => onPause(!paused)}>{paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}{t(paused ? "showOnce.resume" : "showOnce.pause")}</button>
      <button type="button" className={quietButton} disabled={busy} onClick={onDiscard}>{t("showOnce.discard")}</button>
      <button type="button" data-demo-stop className={mdPrimaryCls} disabled={busy} onClick={onDone}>{t("showOnce.stop")}</button>
    </div>
  );
}

const TAKE_TIMEOUT_MS = 12_000;

/**
 * Show it once, on one of a bot's screens: what it is before it starts, the showing while the person holds the screen,
 * the steps to review when they stop, and the replay as it runs. `holding` says the person has taken control here;
 * `onTake` takes it and keeps it, which starting does first so the screen stays theirs for as long as they are showing
 * the task. A change of `asked` opens the start from elsewhere, such as a menu. With `frame`, the nearest positioned
 * box around it is ringed while the bot watches or works.
 */
export function DemoRecorder({ bot, surface, holding, threadId, onTake, asked = 0, frame = false }: { bot: { id: string; name: string }; surface: DemoSurface; holding: boolean; threadId?: string; onTake?: () => void; asked?: number; frame?: boolean }) {
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

  const tone: DockTone | null = run ? runTone(run) : live?.status === "recording" && !live.paused ? "watching" : live?.status === "compiling" ? "working" : null;
  const ring = frame && tone && (!run || run.status === "running") ? FRAME[tone] : undefined;
  return (
    <div data-demo-recorder={live?.status ?? (run ? "replay" : intro ? "intro" : "idle")} className={cn("shrink-0", (live || run || intro) && "order-last")}>
      {ring ? <span aria-hidden="true" data-demo-frame={tone} className={cn("pointer-events-none absolute inset-0 z-20 rounded-[inherit] inset-ring-2", ring)} /> : null}
      {run ? <DemoRun run={run} botName={bot.name} holding={holding} onDismiss={() => setDismissed(run.id)} />
        : live?.status === "recording" ? (
          <Watching live={live} botName={bot.name} title={names[live.id] ?? ""} busy={busy}
            onUndo={() => void act(() => demos.undo(bot.id))}
            onPause={(paused) => void act(() => demos.pause(bot.id, paused))}
            onDiscard={() => void act(() => demos.cancel(bot.id))}
            onDone={() => void stop()} />
        ) : live ? (
          <div data-demo-dock="writing" className={dockCls}>
            <Mark tone="working"><Loader2 size={16} className="animate-spin text-accent-text" /></Mark>
            <div className="min-w-0 flex-1 basis-40">
              <p role="status" className={dockTitleCls}>{t("showOnce.compiling", { name: bot.name })}</p>
              <p className={dockLineCls}>{actions(live.eventCount)}</p>
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
      {review && <DemoReview key={review.id} recording={review} botName={bot.name} holding={holding} named={names[review.id] ?? ""} onAgain={offered ? () => { setReviewing(null); setIntro(true); } : undefined} onClose={() => setReviewing(null)} />}
    </div>
  );
}
