import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { Icon } from "@/components/Icon";
import { ComposerVoiceStrip, VoiceWaveform } from "@/components/ComposerVoiceStrip";
import type { DictationPhase, LevelSource } from "@/lib/use-composer-dictation";
import { cn } from "@/lib/cn";
import { dur, ease, offset, spring } from "@lab/tokens";
import type { LabProps } from "@lab/types";
import "@/styles/composer.css";
import { CONTROL, FIELD, PILL, SLOT, Stage, useLater, useScript } from "./kit";

const SPOKEN = "remind me to call the dentist tomorrow at nine".split(" ");

/** a fake microphone: speech-like loudness while words come, near silence between them */
function useFakeLevels(on: boolean) {
  const listeners = useRef(new Set<(level: number) => void>());
  const level = useMotionValue(0);
  useEffect(() => {
    if (!on) {
      level.set(0);
      return;
    }
    let t = 0;
    const timer = window.setInterval(() => {
      t += 1;
      const syllable = Math.max(0, Math.sin(t / 1.7)) * (0.55 + 0.4 * Math.sin(t / 7.3) ** 2);
      const value = Math.min(1, syllable * (0.7 + Math.random() * 0.5));
      level.set(value);
      listeners.current.forEach((cb) => cb(value));
    }, 50);
    return () => window.clearInterval(timer);
  }, [on, level]);
  const subscribe: LevelSource = useMemo(() => (cb) => {
    listeners.current.add(cb);
    return () => { listeners.current.delete(cb); };
  }, []);
  return { subscribe, level };
}

function useVoiceDemo({ replayKey, speed }: LabProps) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [words, setWords] = useState(0);
  const [text, setText] = useState("");
  const later = useLater(speed);
  const wordTimers = useRef<Array<() => void>>([]);
  const clearWords = () => { wordTimers.current.forEach((stop) => stop()); wordTimers.current = []; };
  const start = () => {
    clearWords();
    setText("");
    setWords(0);
    setPhase("listening");
    SPOKEN.forEach((_, i) => wordTimers.current.push(later(420 + i * 260, () => setWords(i + 1))));
  };
  const finish = () => {
    clearWords();
    setPhase("finishing");
    later(650, () => {
      setText(SPOKEN.join(" ").replace(/^./, (c) => c.toUpperCase()));
      setPhase("idle");
    });
  };
  const discard = () => { clearWords(); setPhase("idle"); setWords(0); };
  const stop = useScript(replayKey, speed, [[500, start], [420 + SPOKEN.length * 260 + 500, finish]], () => { clearWords(); setPhase("idle"); setText(""); setWords(0); });
  const preview = SPOKEN.slice(0, words).join(" ");
  const recording = phase !== "idle";
  const levels = useFakeLevels(phase === "listening");
  return {
    phase, preview, words: SPOKEN.slice(0, words), text, recording, levels,
    setText: (value: string) => { stop(); setText(value); },
    toggle: () => { stop(); if (phase === "idle") start(); else if (phase === "listening") finish(); },
    discard: () => { stop(); discard(); },
  };
}

type Voice = ReturnType<typeof useVoiceDemo>;

function Field({ voice }: { voice: Voice }) {
  return (
    <textarea rows={1} value={voice.text} aria-label="message dusk bot" placeholder="Message dusk bot"
      onChange={(event) => voice.setText(event.target.value)} className={cn(FIELD, "mt-[3px] mb-px min-h-5 p-0")} />
  );
}

function Plus() {
  return <button type="button" aria-label="add files" className={cn(CONTROL, "composer-press")}><Icon name="plus" size={16} /></button>;
}

/* ---------------- Original ---------------- */

export function VoiceOriginal(props: LabProps) {
  const voice = useVoiceDemo(props);
  const filled = Boolean(voice.text.trim());
  return (
    <Stage>
      <div className={cn(PILL, "rounded-[22px]")}>
        <div className="flex items-end gap-2">
          <Plus />
          <div className={cn("min-w-0 flex-1", voice.recording && "hidden")}><Field voice={voice} /></div>
          {voice.recording && (
            <ComposerVoiceStrip phase={voice.phase} preview={voice.preview} levels={voice.levels.subscribe} hasLevels className="mb-px mt-[3px] flex-1" />
          )}
          <div className="relative flex items-center gap-2">
            {voice.recording && (
              <button type="button" aria-label="discard dictation" onClick={voice.discard} className={CONTROL}><Icon name="close" size={14} /></button>
            )}
            {!voice.recording && !filled && <span aria-hidden className="size-7 shrink-0" />}
            <button
              type="button"
              onClick={voice.toggle}
              disabled={voice.phase === "finishing"}
              aria-label={voice.recording ? "stop dictating" : "dictate"}
              data-voice-mic={voice.recording ? "done" : "start"}
              className={cn("flex size-7 shrink-0 items-center justify-center rounded-full",
                voice.recording ? "composer-press bg-ink text-app disabled:opacity-40" : filled ? CONTROL : "composer-press hover:brightness-[0.88]")}
              style={!voice.recording && !filled ? { backgroundColor: SLOT.fill, color: SLOT.ink } : undefined}
            >
              {voice.recording ? <Icon name="check" size={14} /> : <Icon name="mic" variant="filled" size={16} />}
            </button>
            {filled && !voice.recording && (
              <button type="button" aria-label="send" className="composer-press flex size-7 items-center justify-center rounded-full" style={{ backgroundColor: SLOT.fill, color: SLOT.ink }}>
                <Icon name="arrow-up" variant="filled" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </Stage>
  );
}

/* ---------------- A and B share the shell; the strip and the button differ ---------------- */

/** words fade in as they are heard; B adds a rise and blur */
function Words({ words, phase, lively }: { words: string[]; phase: DictationPhase; lively: boolean }) {
  if (!words.length) return <span className="text-ink/40">{phase === "finishing" ? "Transcribing…" : "Listening…"}</span>;
  return (
    <span className="flex min-w-0 justify-end gap-[0.28em] overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,transparent,black_28px)]">
      {words.map((word, i) => (
        <motion.span
          key={i}
          className="shrink-0 text-ink"
          initial={lively ? { opacity: 0, y: 6, filter: "blur(3px)" } : { opacity: 0 }}
          animate={{ opacity: phase === "finishing" ? 0.5 : 1, y: 0, filter: "blur(0px)" }}
          transition={lively ? spring.fade : { duration: dur.fast, ease: ease.out }}
        >
          {word}
        </motion.span>
      ))}
    </span>
  );
}

function VoiceShell({ voice, lively, reduced }: { voice: Voice; lively: boolean; reduced: boolean }) {
  const filled = Boolean(voice.text.trim());
  const ringScale = useTransform(voice.levels.level, [0, 1], [1, 1.15]);
  const ring = useSpring(ringScale, { stiffness: 900, damping: 50 });
  const enterStrip = lively
    ? { initial: { opacity: 0, clipPath: "inset(0 0 0 100%)" }, animate: { opacity: 1, clipPath: "inset(0 0 0 0%)", transition: { duration: dur.d320, ease: ease.out } } }
    : { initial: { opacity: 0, y: 6, filter: `blur(${offset.blurOut}px)` }, animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: dur.swap, ease: ease.out } } };
  return (
    <Stage>
      <div className={cn(PILL, "rounded-[22px]")}>
        <div className="flex items-end gap-2">
          <Plus />
          <div className="relative min-h-6 min-w-0 flex-1">
            <AnimatePresence mode="popLayout" initial={false}>
              {voice.recording ? (
                <motion.div key="strip" {...enterStrip}
                  exit={{ opacity: 0, transition: { duration: dur.exit, ease: ease.out } }}
                  className="mb-px mt-[3px] flex min-h-5 min-w-0 items-center gap-3 text-[14px] leading-5 tracking-[0.01em]">
                  <VoiceWaveform levels={voice.levels.subscribe} hasLevels className="w-[88px] shrink-0" />
                  <span role="status" className="sr-only">{voice.phase === "finishing" ? "Transcribing" : "Listening"}</span>
                  <Words words={voice.words} phase={voice.phase} lively={lively} />
                </motion.div>
              ) : (
                <motion.div key="field"
                  initial={{ opacity: 0, y: lively ? 0 : 4 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: dur.fast, ease: ease.out } }}
                  exit={{ opacity: 0, transition: { duration: dur.d75 } }}>
                  <Field voice={voice} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="relative flex items-center gap-2">
            <AnimatePresence initial={false}>
              {voice.recording && (
                <motion.button key="discard" type="button" aria-label="discard dictation" onClick={voice.discard} className={CONTROL}
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1, transition: { duration: dur.swap, ease: ease.out } }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: dur.exit } }}>
                  <Icon name="close" size={14} />
                </motion.button>
              )}
            </AnimatePresence>
            {!voice.recording && !filled && <span aria-hidden className="size-7 shrink-0" />}
            <span className="relative flex">
              {lively && voice.phase === "listening" && !reduced && (
                <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-ink/[0.16]" style={{ scale: ring }} />
              )}
              <motion.button
                type="button"
                onClick={voice.toggle}
                disabled={voice.phase === "finishing"}
                aria-label={voice.recording ? "stop dictating" : "dictate"}
                whileTap={reduced ? undefined : { scale: offset.pressScale }}
                className={cn("relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full transition-[background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                  voice.recording ? "bg-ink text-app" : filled ? "bg-ink/[0.06] text-ink/[0.56] hover:bg-ink/10 hover:text-ink" : "")}
                style={!voice.recording && !filled ? { backgroundColor: SLOT.fill, color: SLOT.ink } : undefined}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={voice.recording ? "check" : "mic"} className="flex"
                    initial={{ opacity: 0, y: offset.swapIn, filter: "blur(3px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: lively ? spring.pop : { duration: dur.swap, ease: ease.out } }}
                    exit={{ opacity: 0, y: offset.swapOut, filter: "blur(2px)", transition: { duration: dur.exit } }}>
                    {voice.recording ? <Icon name="check" size={14} /> : <Icon name="mic" variant="filled" size={16} />}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </span>
            <AnimatePresence initial={false}>
              {filled && !voice.recording && (
                <motion.button key="send" type="button" aria-label="send" className="flex size-7 items-center justify-center rounded-full"
                  style={{ backgroundColor: SLOT.fill, color: SLOT.ink }}
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1, transition: lively ? spring.pop : { duration: dur.swap, ease: ease.out } }}
                  exit={{ opacity: 0, transition: { duration: dur.exit } }}>
                  <Icon name="arrow-up" variant="filled" size={16} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Stage>
  );
}

export const VoiceA = (props: LabProps) => <VoiceShell voice={useVoiceDemo(props)} lively={false} reduced={props.reduced} />;
export const VoiceB = (props: LabProps) => <VoiceShell voice={useVoiceDemo(props)} lively reduced={props.reduced} />;
