import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, ms, spring } from "@lab/tokens";
import { MAUS_COLORS } from "@/lib/mascot";
import { t } from "@/lib/i18n";
import { AMY, BotBubble, Controls, LabButton, Row, Stage, UserBubble, cn, useScript, SIMPLE_BOT_BUBBLE } from "../kit";
import { Arrive, StatusLine, TYPING } from "../shipped";
import { REPLY, useFakeStream, useSmoothText, words } from "../stream";

type Mode = "original" | "a" | "b";

/** keeps a scroller at its end while what it holds grows, and lets go once the person scrolls up (use-stick-to-bottom behaviour, MIT, rebuilt) */
export function useStickToBottom() {
  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current, inner = column.current;
    if (!el || !inner) return;
    const onScroll = () => { pinned.current = el.scrollHeight - el.clientHeight - el.scrollTop < 24; };
    const observer = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    observer.observe(inner);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, []);
  return { scroller, column, pin: () => { pinned.current = true; } };
}

function Streaming({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [running, setRunning] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [stopped, setStopped] = useState<string | null>(null);
  const { received, done } = useFakeStream(REPLY, running, runKey, speed);
  const start = () => { setStopped(null); setRunning(true); setRunKey((k) => k + 1); stick.pin(); };
  useScript(replayKey, speed, [[0, () => { setRunning(false); setStopped(null); }], [300, start]]);
  const stick = useStickToBottom();
  const smooth = useSmoothText(stopped ?? received, { speed, enabled: mode !== "original" });
  const streaming = running && !done && stopped === null;
  const stop = () => { setStopped(mode === "original" ? received : smooth); };

  return (
    <Stage>
      <Controls>
        {streaming ? <LabButton onClick={stop}>Stop</LabButton> : <LabButton onClick={start}>Stream again</LabButton>}
      </Controls>
      <div ref={stick.scroller} className="min-h-0 flex-1 overflow-y-auto px-4 [overflow-anchor:none] [scrollbar-width:none]">
        <div ref={stick.column} className="flex min-h-full flex-col justify-end gap-4 pt-10 pb-4">
          <Row side="end"><UserBubble>cheapest flight to goa this weekend?</UserBubble></Row>
          {mode === "original" ? (
            <ShippedReply running={running} received={received} done={done} stopped={stopped} reduced={reduced} />
          ) : (
            running && (
              <>
                {smooth ? (
                  mode === "a"
                    ? <Row side="start"><FadeIn reduced={reduced}><BotBubble><StreamWords text={smooth} cls="lab-word-fade" /></BotBubble></FadeIn></Row>
                    : <Row side="start"><GrowingBubble text={smooth} live={streaming || (stopped === null && smooth !== received)} reduced={reduced} speed={speed} /></Row>
                ) : (
                  !stopped && <StatusLine bot={AMY} state="thinking" />
                )}
                {stopped !== null && <div className="turn-stopped flex h-9 items-center ps-3 text-[13px] text-ink-tertiary" role="status">{t("chat.turnStopped")}</div>}
              </>
            )
          )}
        </div>
      </div>
    </Stage>
  );
}

/** today's desktop chat: the reply is written whole; while it streams the line says Typing, then the bubble lands */
function ShippedReply({ running, received, done, stopped, reduced }: { running: boolean; received: string; done: boolean; stopped: string | null; reduced: boolean }) {
  if (!running) return null;
  if (stopped !== null) {
    return (
      <>
        {stopped && <Arrive reduced><BotBubble>{stopped}</BotBubble></Arrive>}
        <div className="turn-stopped flex h-9 items-center ps-3 text-[13px] text-ink-tertiary" role="status">{t("chat.turnStopped")}</div>
      </>
    );
  }
  if (done) return <Arrive reduced={reduced}><BotBubble>{received}</BotBubble></Arrive>;
  return <StatusLine bot={AMY} state={received ? "streaming" : "thinking"} label={received ? TYPING() : null} />;
}

function FadeIn({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  return (
    <motion.div initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.swap, ease: ease.out }}>
      {children}
    </motion.div>
  );
}

/** each word mounts once and plays its entrance; words already shown never replay */
function StreamWords({ text, cls, stagger = 0 }: { text: string; cls: string; stagger?: number }) {
  const scheduled = useRef<{ count: number; at: number }>({ count: 0, at: 0 });
  const list = words(text);
  const delays = useRef<number[]>([]);
  const now = performance.now();
  for (let i = scheduled.current.count; i < list.length; i++) {
    // a burst spreads 40ms apart, but never falls more than 320ms behind what arrived (Streamdown's backlog cap, Apache-2.0)
    const next = Math.max(now, scheduled.current.at + stagger);
    delays.current[i] = Math.min(next - now, 320);
    scheduled.current.at = now + delays.current[i]!;
  }
  scheduled.current.count = Math.max(scheduled.current.count, list.length);
  return <>{list.map((word, i) => <span key={i} className={cls} style={delays.current[i] ? { animationDelay: `${delays.current[i]}ms` } : undefined}>{word}</span>)}</>;
}

/** B: the bubble's box springs to the words' size, width first then height, with a breathing caret at the tail */
function GrowingBubble({ text, live, reduced, speed }: { text: string; live: boolean; reduced: boolean; speed: number }) {
  const row = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(320);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const r = row.current, el = inner.current;
    if (!r || !el) return;
    const observer = new ResizeObserver(() => {
      setMax(Math.floor(r.clientWidth * 0.85) - 24);
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
    });
    observer.observe(r);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [caret, setCaret] = useState(live);
  useEffect(() => {
    if (live) { setCaret(true); return; }
    const timer = setTimeout(() => setCaret(false), ms(250, speed));
    return () => clearTimeout(timer);
  }, [live, speed]);
  return (
    <div ref={row} className="w-full">
      <motion.div
        data-chat-bubble="simple"
        className={cn(SIMPLE_BOT_BUBBLE, "chat-text relative overflow-hidden rounded-es-[6px] !p-0")}
        initial={reduced ? { opacity: 0, width: 36, height: 34 } : { opacity: 0, y: 8, width: 36, height: 34 }}
        animate={{ opacity: 1, y: 0, width: size.w + 24, height: size.h + 14 }}
        transition={reduced
          ? { duration: 0, opacity: { duration: dur.fast } }
          : { width: spring.width, height: { ...spring.bubble, delay: 0.04 }, y: spring.enter, opacity: { duration: dur.fast } }}
      >
        <div ref={inner} className="absolute start-3 top-[7px] w-max" style={{ maxWidth: max }}>
          <StreamWords text={text} cls="lab-word-blur" stagger={reduced ? 0 : 40} />
          <AnimatePresence>
            {caret && (
              <motion.span
                key="caret"
                aria-hidden="true"
                className="lab-caret ms-0.5 inline-block h-[14px] w-[3px] translate-y-[2px] rounded-full"
                style={{ backgroundColor: MAUS_COLORS[AMY.color] }}
                exit={{ opacity: 0, transition: { duration: dur.fast } }}
              />
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

export const streaming: Item = {
  id: "streaming-reply",
  title: "Streaming reply (smoothing, word fade, caret, stick to bottom)",
  surface: "chat",
  height: 340,
  loopMs: 7000,
  notes: {
    original: "Desktop never shows the stream: the line says Typing… (stepped shimmer) while it streams, then the whole bubble rises 12px / 240ms. Stop: what was said lands, then Stopped fades in 180ms. (The island and dock append raw.)",
    a: "Words stream into the bubble. Bursty chunks drain over 250ms, max 5ms/char (assistant-ui useSmooth behaviour, MIT, rebuilt); each new word fades in 150ms ease, no travel, no caret. Pinned to the end, lets go when you scroll up. Reduced: same text pacing, no fade.",
    b: "A's smoothing, but each word condenses in (opacity + 4px blur, 220ms ease.out, 40ms stagger capped at 320ms, Streamdown blurIn, Apache-2.0); the bubble springs to fit (width 380/24, height 260/26 +40ms) and a 3px caret in the bot's colour breathes at the tail, fading 150ms when done.",
  },
  Original: (p) => <Streaming {...p} mode="original" />,
  A: (p) => <Streaming {...p} mode="a" />,
  B: (p) => <Streaming {...p} mode="b" />,
};
