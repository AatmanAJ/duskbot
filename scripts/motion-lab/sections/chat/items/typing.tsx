import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, offset, spring, timing } from "@lab/tokens";
import { AMY, BotBubble, Row, Stage, Transcript, UserBubble, cn, useScript, SIMPLE_BOT_BUBBLE } from "../kit";
import { Arrive, StatusLine, TYPING } from "../shipped";

const REPLY = "Saturday works. IndiGo 6:10, ₹4,280 return.";
type Mode = "original" | "a" | "b";

function Typing({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [typing, setTyping] = useState(false);
  const [replied, setReplied] = useState(false);
  useScript(replayKey, speed, [
    [0, () => { setTyping(false); setReplied(false); }],
    [mode === "original" ? 0 : 150, () => setTyping(true)],
    [2300, () => setReplied(true)],
  ]);
  return (
    <Stage>
      <Transcript>
        <Row side="end"><UserBubble>does saturday work?</UserBubble></Row>
        {mode === "original" && (replied
          ? <Arrive reduced={reduced}><BotBubble>{REPLY}</BotBubble></Arrive>
          : typing && <StatusLine bot={AMY} state="streaming" label={TYPING()} />)}
        {mode === "a" && (
          <div className="grid">
            <AnimatePresence initial={false}>
              {typing && !replied && (
                <motion.div key="dots" className="[grid-area:1/1]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: dur.exit } }} transition={{ duration: dur.fast, ease: ease.out }}>
                  <DotsBubble />
                </motion.div>
              )}
              {replied && (
                <motion.div key="reply" className="[grid-area:1/1]" initial={reduced ? { opacity: 0 } : { opacity: 0, y: offset.swapIn }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.swap, ease: ease.out, delay: dur.exit }}>
                  <BotBubble>{REPLY}</BotBubble>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {mode === "b" && typing && <MorphBubble replied={replied} reduced={reduced} />}
      </Transcript>
    </Stage>
  );
}

function Dots() {
  return (
    <span className="flex h-5 items-center gap-[5px] text-ink-secondary" aria-label={TYPING()} role="status">
      {[0, 160, 320].map((delay) => <span key={delay} className="lab-dot size-[6px] rounded-full bg-current" style={{ animationDelay: `${delay}ms` }} />)}
    </span>
  );
}

function DotsBubble() {
  return <div data-chat-bubble="simple" className={cn(SIMPLE_BOT_BUBBLE, "w-fit rounded-es-[6px] !px-3.5")}><Dots /></div>;
}

/** B: the dots' bubble becomes the reply's: width lands first, then height, and the words arrive 80ms after the box */
function MorphBubble({ replied, reduced }: { replied: boolean; reduced: boolean }) {
  const measure = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ w: 46, h: 34 });
  useLayoutEffect(() => {
    if (!replied || !measure.current) return;
    setSize({ w: measure.current.offsetWidth + 24, h: measure.current.offsetHeight + 14 });
  }, [replied]);
  const lag = timing.contentLag / 1000;
  return (
    <div className="relative w-full">
      <span ref={measure} aria-hidden="true" className="chat-text invisible absolute w-max max-w-[min(300px,80%)] text-[15px] leading-5">{REPLY}</span>
      <motion.div
        data-chat-bubble="simple"
        className={cn(SIMPLE_BOT_BUBBLE, "chat-text relative overflow-hidden rounded-es-[6px] !p-0")}
        initial={reduced ? { opacity: 0, width: 46, height: 34 } : { opacity: 0, scale: 0.9, width: 46, height: 34 }}
        animate={{ opacity: 1, scale: 1, width: size.w, height: size.h }}
        style={{ originX: 0, originY: 1 }}
        transition={reduced ? { duration: 0, opacity: { duration: dur.fast } } : { width: spring.width, height: { ...spring.height, delay: 0.06 }, scale: spring.pop, opacity: { duration: dur.fast } }}
      >
        <AnimatePresence initial={false}>
          {!replied ? (
            <motion.span key="dots" className="absolute start-3.5 top-[7px]" exit={{ opacity: 0, transition: { duration: dur.exit } }}><Dots /></motion.span>
          ) : (
            <motion.span
              key="text"
              className="absolute start-3 top-[7px] w-max max-w-[min(300px,80%)]"
              style={{ maxWidth: size.w - 24 }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, filter: `blur(${offset.blurOut}px)` }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{ duration: dur.swap, ease: ease.out, delay: lag }}
            >
              {REPLY}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export const typing: Item = {
  id: "typing-indicator",
  title: "Typing indicator into the reply",
  surface: "chat",
  height: 260,
  loopMs: 3600,
  notes: {
    original: "The status line: the mascot in its writing pose and Typing… with grok's stepped shimmer, shown at once; it leaves in 140ms and the reply rises 12px / 240ms.",
    a: "Nothing for 150ms (fast replies never flash), then three dots in a bot bubble fade in 150ms, waving 1.2s, 160ms apart (prompt-kit Loader, MIT, rebuilt). Reply: dots out 120ms, bubble fades up 8px / 200ms.",
    b: "The dots' bubble pops in (.9, 520/26) and becomes the reply: width 380/24 lands first, height 300/22 +60ms, words fade from 2px blur 80ms after the box (DesignBookmark goo-thinking idea, no goo).",
  },
  Original: (p) => <Typing {...p} mode="original" />,
  A: (p) => <Typing {...p} mode="a" />,
  B: (p) => <Typing {...p} mode="b" />,
};
