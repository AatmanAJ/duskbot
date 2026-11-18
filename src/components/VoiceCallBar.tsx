import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, MessageSquareText, Mic, MicOff, PhoneOff, RotateCcw, Settings } from "../icons";

import { deferCallCleanup, endCall } from "@/lib/call";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CALL_SPEEDS, CALL_VOICES, callPrefs, setCallPrefs, useCallPrefs, voiceForBot, type CallVoiceId } from "@/lib/voice-call/prefs";
import { VoiceCallSession, type CallFacts, type CallSnapshot } from "@/lib/voice-call/session";
import { useStore, visibleMessages, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { OpenSystemSettings } from "./OpenSystemSettings";
import { pendingApprovals, spokenApprovalPrompt } from "./PendingApproval";
import { VoiceCallWave, type WaveSource } from "./VoiceCallWave";

function useSession(session: VoiceCallSession): CallSnapshot {
  return useSyncExternalStore((fn) => session.subscribe(fn), () => session.state, () => session.state);
}

function factsFor(bot: Bot): CallFacts {
  const messages = visibleMessages(bot);
  const approval = pendingApprovals(messages)[0];
  const question = messages.find((m) => m.kind === "options" && m.card?.requestId && !m.card.tool && !m.card.answered && !m.card.dismissed);
  const step = bot.busy ? [...messages].reverse().find((m) => m.kind === "activity" && m.tool?.spoken && m.tool.ok === undefined) : undefined;
  const detail = question?.card?.subtitle.trim() ?? "";
  return {
    busy: Boolean(bot.busy),
    approval: approval ? { requestId: approval.requestId, prompt: spokenApprovalPrompt(approval, bot.name) } : null,
    question: question?.card?.requestId
      ? {
          requestId: question.card.requestId,
          messageId: question.id,
          prompt: t("call.question", {
            name: bot.name,
            detail: `${detail}${/[.!?]$/.test(detail) ? "" : "."}`,
            choices: question.card.options.length ? t("call.questionOptions", { options: question.card.options.join(", ") }) : "",
          }),
        }
      : null,
    step: step?.tool?.spoken ? { id: step.id, spoken: step.tool.spoken } : null,
  };
}

const ROUND = "flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 active:scale-[0.94]";

export function VoiceCall({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const prefs = useCallPrefs();
  const voice = voiceForBot(bot.id, prefs);
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<VoiceCallSession | null>(null);
  const botRef = useRef(bot);
  botRef.current = bot;

  useEffect(() => {
    const { id, threadId } = botRef.current;
    const next = new VoiceCallSession(
      { id, threadId },
      {
        send: (text, callId) => dispatch({ type: "send", botId: id, threadId, text, voiceCall: { callId } }),
        decide: (requestId, allow) => dispatch({ type: "decideRequest", threadId, requestId, behavior: allow ? "allow" : "deny", message: allow ? undefined : t("call.denied") }),
        answer: (messageId, text) => dispatch({ type: "answerCard", botId: id, threadId, messageId, answer: text }),
      },
      { voice: voiceForBot(id), speed: callPrefs().speed },
    );
    next.skipSteps(visibleMessages(botRef.current).filter((m) => m.kind === "activity").map((m) => m.id));
    setSession(next);
    void next.start();
    return () => next.close();
  }, [bot.id, bot.threadId, attempt, dispatch]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const id = bot.id;
    return () => {
      alive.current = false;
      deferCallCleanup(id, () => alive.current);
    };
  }, [bot.id]);

  useEffect(() => session?.setVoice(voice, prefs.speed), [session, voice, prefs.speed]);
  useEffect(() => session?.update(factsFor(bot)), [session, bot]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        endCall(bot.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bot.id]);

  if (!session) return null;
  return <CallSurface bot={bot} session={session} transcript={prefs.transcript} voice={voice} speed={prefs.speed} onRetry={() => setAttempt((n) => n + 1)} />;
}

function CallSurface({ bot, session, transcript, voice, speed, onRetry }: {
  bot: Bot;
  session: VoiceCallSession;
  transcript: boolean;
  voice: CallVoiceId;
  speed: number;
  onRetry: () => void;
}) {
  const snap = useSession(session);
  const wave = useCallback<WaveSource>(() => {
    const botLevel = session.botLevel();
    if (botLevel > 0.01) return { level: botLevel, who: "bot" };
    return { level: snap.muted ? 0 : session.micLevel, who: session.micLevel > 0.08 ? "person" : "none" };
  }, [session, snap.muted]);
  return (
    <>
      {!transcript && <CallStage bot={bot} snap={snap} />}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-2 px-4 pb-4">
        <HeardLine snap={snap} />
        <CallPill bot={bot} snap={snap} session={session} wave={wave} transcript={transcript} voice={voice} speed={speed} onRetry={onRetry} />
      </div>
    </>
  );
}

function statusText(snap: CallSnapshot, name: string): string | null {
  if (snap.phase === "connecting") return t("call.live.connecting");
  if (snap.phase === "preparing") return t("call.voice.preparing", { percent: Math.round((snap.progress ?? 0) * 100) });
  if (snap.phase !== "error") return null;
  const kind = snap.error?.kind;
  if (kind === "microphone-blocked") return t("call.voice.micBlocked");
  if (kind === "microphone-missing") return t("call.voice.micMissing");
  if (kind === "microphone-failed") return t("call.voice.micFailed");
  return t("call.voice.failed", { name });
}

function phaseLabel(snap: CallSnapshot, name: string): string {
  if (snap.muted) return t("call.voice.muted");
  if (snap.phase === "hearing") return t("call.voice.hearing");
  if (snap.phase === "thinking") return t("call.voice.thinking", { name });
  if (snap.phase === "speaking") return t("call.voice.speaking", { name });
  return t("call.voice.listening");
}

function CallPill({ bot, snap, session, wave, transcript, voice, speed, onRetry }: {
  bot: Bot;
  snap: CallSnapshot;
  session: VoiceCallSession;
  wave: WaveSource;
  transcript: boolean;
  voice: CallVoiceId;
  speed: number;
  onRetry: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const status = statusText(snap, bot.name);
  const failed = snap.phase === "error";
  const live = !status;

  useEffect(() => {
    if (!settingsOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setSettingsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSettingsOpen(false);
      gear.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape, true);
    };
  }, [settingsOpen]);

  const mascot = snap.phase === "speaking" ? "sending" : snap.phase === "thinking" ? "thinking" : snap.phase === "hearing" ? "listening" : "idle";
  return (
    <div
      ref={root}
      role="region"
      aria-label={t("call.callWith", { name: bot.name })}
      data-voice-call={snap.phase}
      className="voice-call-pill pointer-events-auto relative flex h-14 items-center gap-1.5 rounded-full bg-menu py-2 pl-2 pr-2 text-ink shadow-[0_10px_34px_-8px_rgba(0,0,0,0.28),0_2px_8px_-2px_rgba(0,0,0,0.12)]"
    >
      <BotAvatar bot={bot} size={40} state={mascot as never} animated />
      <div className="flex h-10 min-w-[150px] items-center justify-center px-2" aria-live="polite">
        {live ? (
          <>
            <VoiceCallWave
              source={wave}
              className="[--wave-bot:var(--color-accent)] [--wave-idle:var(--color-ink-tertiary)] [--wave-person:var(--color-ink)]"
            />
            <span className="sr-only">{phaseLabel(snap, bot.name)}</span>
          </>
        ) : (
          <span className={cn("max-w-[260px] truncate text-[13px] tabular-nums", failed ? "text-ink" : "text-ink-secondary")} title={status}>
            {status}
          </span>
        )}
      </div>
      {failed && snap.error?.kind === "microphone-blocked" && <OpenSystemSettings pane="mic" />}
      {failed && snap.error?.kind !== "microphone-blocked" && (
        <button type="button" aria-label={t("call.voice.retry")} title={t("call.voice.retry")} className={cn(ROUND, "bg-ink/[0.06] text-ink hover:bg-ink/[0.1]")} onClick={onRetry}>
          <RotateCcw size={17} />
        </button>
      )}
      <button
        ref={gear}
        type="button"
        aria-label={t("call.live.settings")}
        title={t("call.live.settings")}
        aria-expanded={settingsOpen}
        aria-haspopup="dialog"
        className={cn(ROUND, settingsOpen ? "bg-ink/[0.1] text-ink" : "bg-ink/[0.06] text-ink-secondary hover:bg-ink/[0.1] hover:text-ink")}
        onClick={() => setSettingsOpen((open) => !open)}
      >
        <Settings size={18} />
      </button>
      <button
        type="button"
        aria-pressed={transcript}
        aria-label={transcript ? t("call.voice.transcriptHide") : t("call.voice.transcriptShow")}
        title={transcript ? t("call.voice.transcriptHide") : t("call.voice.transcriptShow")}
        className={cn(ROUND, transcript ? "bg-ink/[0.1] text-ink" : "bg-ink/[0.06] text-ink-secondary hover:bg-ink/[0.1] hover:text-ink")}
        onClick={() => setCallPrefs({ transcript: !transcript })}
      >
        <MessageSquareText size={18} />
      </button>
      <button
        type="button"
        aria-pressed={snap.muted}
        aria-label={snap.muted ? t("call.live.unmute") : t("call.live.mute")}
        title={snap.muted ? t("call.live.unmute") : t("call.live.mute")}
        disabled={!live && !failed}
        className={cn(ROUND, snap.muted ? "bg-ink text-app hover:opacity-90" : "bg-ink/[0.06] text-ink-secondary hover:bg-ink/[0.1] hover:text-ink", "disabled:opacity-50")}
        onClick={() => session.setMuted(!snap.muted)}
      >
        {snap.muted ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      <button
        type="button"
        aria-label={t("call.live.hangUp")}
        title={t("call.live.hangUp")}
        className={cn(ROUND, "bg-danger text-white hover:brightness-110")}
        onClick={() => endCall(bot.id)}
      >
        <PhoneOff size={18} />
      </button>
      {settingsOpen && (
        <CallSettings
          voice={voice}
          speed={speed}
          onVoice={(id) => {
            setCallPrefs({ voices: { ...callPrefs().voices, [bot.id]: id } });
            session.setVoice(id, speed);
            session.preview(t("call.voice.previewLine", { name: bot.name }));
          }}
          onSpeed={(value) => {
            setCallPrefs({ speed: value });
            session.setVoice(voice, value);
            session.preview(t("call.voice.previewLine", { name: bot.name }));
          }}
        />
      )}
    </div>
  );
}

function CallSettings({ voice, speed, onVoice, onSpeed }: {
  voice: CallVoiceId;
  speed: number;
  onVoice: (id: CallVoiceId) => void;
  onSpeed: (value: number) => void;
}) {
  return (
    <div
      role="dialog"
      aria-label={t("call.live.settings")}
      className="voice-call-menu absolute bottom-full right-10 mb-2 w-[248px] rounded-2xl bg-menu p-1.5 text-left shadow-[0_14px_40px_-10px_rgba(0,0,0,0.3),0_2px_8px_-2px_rgba(0,0,0,0.12)]"
    >
      <div className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-ink-secondary">{t("call.voice.voice")}</div>
      <div role="radiogroup" aria-label={t("call.voice.voice")} className="grid grid-cols-2 gap-0.5">
        {CALL_VOICES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="radio"
            aria-checked={voice === entry.id}
            onClick={() => onVoice(entry.id)}
            className={cn("flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] text-ink hover:bg-menu-hover", voice === entry.id && "bg-menu-active")}
          >
            {entry.label}
            {voice === entry.id && <Check size={13} className="text-accent" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="px-2.5 pb-1 pt-2.5 text-[12px] font-medium text-ink-secondary">{t("call.voice.speed")}</div>
      <div role="radiogroup" aria-label={t("call.voice.speed")} className="flex gap-0.5 rounded-xl bg-ink/[0.05] p-0.5">
        {CALL_SPEEDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="radio"
            aria-checked={speed === entry.value}
            onClick={() => onSpeed(entry.value)}
            className={cn("flex-1 rounded-[10px] py-1.5 text-[12px] font-medium transition-colors", speed === entry.value ? "bg-menu text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-secondary hover:text-ink")}
          >
            {t(entry.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What the person is saying, shown while they say it: it lands in the chat once it is sent. */
function HeardLine({ snap }: { snap: CallSnapshot }) {
  const text = snap.phase === "hearing" || snap.phase === "thinking" ? snap.heard : "";
  return (
    <div className={cn("voice-call-heard pointer-events-none max-w-[min(520px,90%)] truncate rounded-full bg-menu/90 px-3.5 py-1.5 text-[13px] text-ink-secondary shadow-[0_4px_16px_-6px_rgba(0,0,0,0.18)] [direction:rtl]", !text && "invisible")}>
      <bdi dir="ltr">{text || " "}</bdi>
    </div>
  );
}

/** Without the transcript, the chat steps back and the bot is the call. */
function CallStage({ bot, snap }: { bot: Bot; snap: CallSnapshot }) {
  const mascot = snap.phase === "speaking" ? "sending" : snap.phase === "thinking" ? "thinking" : snap.phase === "hearing" ? "listening" : "idle";
  return (
    <div className="voice-call-stage absolute inset-0 z-[29] flex flex-col items-center justify-center gap-5 bg-app px-6 pb-24">
      <BotAvatar bot={bot} size={168} state={mascot as never} animated trackPointer />
      <div className="text-[18px] font-medium text-ink">{bot.name}</div>
      <div className="min-h-[3rem] max-w-[520px] text-center text-[15px] leading-relaxed text-ink-secondary">
        {snap.phase === "speaking" ? snap.caption : snap.phase === "hearing" ? snap.heard : phaseLabel(snap, bot.name)}
      </div>
    </div>
  );
}
