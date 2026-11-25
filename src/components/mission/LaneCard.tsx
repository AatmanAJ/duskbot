import { useState, type FormEvent } from "react";

import type { MissionLane } from "../../../shared/mission";
import { OPEN_LANE_STATES } from "../../../shared/mission";
import { ArrowUpRight, FileText, Folder, Play, RotateCcw, Send, Square, Users, WandSparkles } from "@/icons";
import { cn } from "@/lib/cn";
import type { MausState } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { sendToLane, stopLane } from "@/state/missions";
import { useStore, type Bot } from "@/state/store";
import { useTurnLive } from "@/state/turn-status";
import { turnNowPhrases } from "@/lib/live-activity";
import { BotAvatar } from "../Avatar";
import { ChatMarkdown } from "../ChatMarkdown";
import { clock, laneLed, laneWord } from "./mission-ui";

const LANE_MASCOT: Record<MissionLane["state"], MausState> = {
  queued: "loading", working: "working", waiting: "waiting", "needs-input": "alerting", done: "finished", failed: "failed", stopped: "idle", idle: "idle",
};

export function LaneLed({ state }: { state: MissionLane["state"] }) {
  return <span aria-hidden="true" className="mc-led" data-led={laneLed(state)} />;
}

export function LaneStateWord({ state, className }: { state: MissionLane["state"]; className?: string }) {
  return <span className={cn("mc-state-word mc-eyebrow", className)} data-led={laneLed(state)}>{t(laneWord(state))}</span>;
}

function LiveStep({ threadId }: { threadId: string }) {
  const live = useTurnLive(threadId);
  const phrase = live.label?.trim() || turnNowPhrases(live.status, undefined)?.phrases[0] || t("chat.activity.thinking");
  return (
    <div data-lane-live className="mc-mono flex min-w-0 items-center gap-2 text-[11.5px]" style={{ color: "var(--mc-led-live)" }}>
      <span aria-hidden="true">▸</span><span className="truncate" dir="auto">{phrase}</span>
    </div>
  );
}

type Composer = "steer" | "answer" | null;

export function LaneCard({ lane, bot, now }: { lane: MissionLane; bot: Bot | undefined; now: number }) {
  const { dispatch } = useStore();
  const [composer, setComposer] = useState<Composer>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = OPEN_LANE_STATES.has(lane.state);
  const name = lane.botName;
  const brief = lane.brief ?? "";
  const elapsed = lane.startedAt ? (lane.finishedAt ?? now) - lane.startedAt : 0;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setText("");
      setComposer(null);
    } catch (failure) {
      setError(t("mission.lane.failedToSend", { error: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (!words || busy) return;
    void run(() => sendToLane(lane.botId, lane.threadId, words, composer === "steer" && lane.state === "working" ? "steer" : undefined));
  };
  const openChat = () => dispatch({ type: "switchTask", botId: lane.botId, threadId: lane.threadId, whole: true });

  return (
    <article data-mission-lane={lane.threadId} data-lane-state={lane.state} data-led={laneLed(lane.state)} aria-label={name}
      className="mc-lane flex min-w-0 flex-col gap-2.5 p-3 pl-3.5">
      <header className="flex items-center gap-2.5">
        {bot ? <BotAvatar bot={bot} size={28} state={LANE_MASCOT[lane.state]} /> : <span className="size-7 rounded-sm bg-raised" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold text-ink">{name}</div>
          <div className="mc-mono flex min-w-0 gap-1 text-[11px] text-ink-tertiary">
            <span>#{String(lane.lane + 1).padStart(2, "0")}{elapsed > 0 && ` · ${clock(elapsed)}`}</span>
            {lane.cwd && <span className="inline-flex min-w-0 items-center gap-0.5 truncate" title={lane.cwd}>· <Folder size={10} aria-hidden="true" />{lane.cwd.split(/[\\/]/).filter(Boolean).at(-1)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5"><LaneLed state={lane.state} /><LaneStateWord state={lane.state} /></div>
      </header>

      <p className="text-[12.5px] leading-[18px] text-ink-secondary" data-lane-reason>{lane.reason}</p>

      {lane.question && (
        <div className="mc-well flex flex-col gap-1.5 border-l-2 px-2.5 py-2 text-[12.5px] leading-[18px] text-ink" style={{ borderLeftColor: "var(--mc-led-you)" }} data-lane-question>
          <span>{lane.question}</span>
          {lane.suggested && (
            <button type="button" className="mc-btn self-start" disabled={busy} onClick={() => void run(() => sendToLane(lane.botId, lane.threadId, lane.suggested!))}>
              {t("mission.lane.useSuggested", { answer: lane.suggested })}
            </button>
          )}
        </div>
      )}

      {(lane.teammates > 0 || lane.files.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-secondary">
          {lane.teammates > 0 && (
            <span className="inline-flex items-center gap-1"><Users size={12} aria-hidden="true" />
              {lane.teammates === 1 ? t(lane.teammatesOpen ? "mission.lane.teammateOpen.one" : "mission.lane.teammate.one")
                : lane.teammatesOpen > 0 ? t("mission.lane.teammatesOpen", { count: lane.teammates, open: lane.teammatesOpen })
                : t("mission.lane.teammates", { count: lane.teammates })}
            </span>
          )}
          {lane.files.length > 0 && (
            <span className="inline-flex min-w-0 items-center gap-1" title={lane.files.map((file) => file.path).join("\n")}><FileText size={12} aria-hidden="true" />
              {lane.files.length === 1 ? t("mission.lane.file.one") : t("mission.lane.files", { count: lane.files.length })}
              <span className="mc-mono truncate text-ink-tertiary">{lane.files.slice(-2).map((file) => file.path.split("/").at(-1)).join(", ")}</span>
            </span>
          )}
        </div>
      )}

      {lane.state === "working" && <LiveStep threadId={lane.threadId} />}
      {(lane.reply || open) && (
        <div className="mc-well max-h-[132px] overflow-hidden px-2.5 py-2 text-[12.5px] leading-[18px]">
          {lane.reply ? <div className="line-clamp-6 text-ink [&_p]:my-0"><ChatMarkdown text={lane.reply} /></div>
            : <span className="text-ink-tertiary">{t("mission.lane.noReply")}</span>}
        </div>
      )}

      {composer && (
        <form onSubmit={submit} className="flex items-end gap-1.5">
          <textarea autoFocus rows={2} value={text} onChange={(event) => setText(event.target.value)} aria-label={composer === "answer" ? t("mission.lane.answerPlaceholder", { name }) : t("mission.lane.steerNamed", { name })}
            placeholder={composer === "answer" ? t("mission.lane.answerPlaceholder", { name }) : t("mission.lane.steerPlaceholder", { name })}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) submit(event); if (event.key === "Escape") setComposer(null); }}
            className="mc-field min-h-[52px] resize-none" />
          <button type="submit" className="mc-btn" data-tone="live" disabled={busy || !text.trim()} aria-label={t("mission.lane.send")}><Send size={13} aria-hidden="true" /></button>
        </form>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}

      <footer className="mt-auto flex flex-wrap items-center gap-1.5">
        {lane.state === "needs-input" && (
          <button type="button" className="mc-btn" data-tone="live" onClick={() => setComposer(composer === "answer" ? null : "answer")}>{t("mission.lane.answer")}</button>
        )}
        {open && lane.state !== "needs-input" && (
          <button type="button" className="mc-btn" aria-label={t("mission.lane.steerNamed", { name })} onClick={() => setComposer(composer === "steer" ? null : "steer")}>
            <WandSparkles size={13} aria-hidden="true" />{t("mission.lane.steer")}
          </button>
        )}
        {open && (
          <button type="button" className="mc-btn" data-tone="stop" disabled={busy} aria-label={t("mission.lane.stopNamed", { name })} onClick={() => void run(() => stopLane(lane.botId, lane.threadId))}>
            <Square size={12} aria-hidden="true" />{t("mission.lane.stop")}
          </button>
        )}
        {lane.state === "idle" && (
          <button type="button" className="mc-btn" data-tone="live" disabled={busy || !brief} onClick={() => void run(() => sendToLane(lane.botId, lane.threadId, brief))}>
            <Play size={12} aria-hidden="true" />{t("mission.lane.start")}
          </button>
        )}
        {(lane.state === "failed" || lane.state === "stopped") && (
          <button type="button" className="mc-btn" disabled={busy || !brief} onClick={() => void run(() => sendToLane(lane.botId, lane.threadId, brief))}>
            <RotateCcw size={12} aria-hidden="true" />{t("mission.lane.runAgain")}
          </button>
        )}
        <button type="button" className="mc-btn ml-auto" aria-label={t("mission.lane.openNamed", { name })} onClick={openChat}>
          {t("mission.lane.open")}<ArrowUpRight size={12} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}
