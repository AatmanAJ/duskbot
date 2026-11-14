import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, ms, offset, spring } from "@lab/tokens";
import { ChevronRight } from "@/icons";
import { AMY, BotBubble, Mascot, Row, Stage, Transcript, UserBubble, cn, useScript } from "../kit";
import { Arrive, StatusLine } from "../shipped";

const STEPS = ["Thinking", "Searching the web", "Reading 3 pages"];
const REASONING = [
  "They want the cheapest return to Goa this weekend.",
  "Checking IndiGo, Air India and Akasa for Sat to Mon.",
  "IndiGo 6:10 is ₹4,280; Akasa Friday is ₹4,900.",
  "Air India 9:40 costs more but the time is kinder.",
  "Lead with IndiGo, offer to hold the seats.",
];
const ANSWER = "Cheapest is IndiGo on Saturday at 6:10, ₹4,280 return. Want me to hold it?";
type Mode = "original" | "a" | "b";
type Phase = "idle" | "think" | "done";

function Thinking({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState(-1);
  const [answered, setAnswered] = useState(false);
  useScript(replayKey, speed, [
    [0, () => { setPhase("think"); setStep(-1); setAnswered(false); }],
    [2000, () => setStep(0)],
    [3300, () => setStep(1)],
    [4600, () => setStep(2)],
    [5900, () => setPhase("done")],
    [mode === "original" ? 6040 : 6200, () => setAnswered(true)],
  ]);
  const label = step >= 0 ? STEPS[step]! : null;
  return (
    <Stage>
      <Transcript>
        <Row side="end"><UserBubble>cheapest flight to goa this weekend?</UserBubble></Row>
        {mode === "original" && phase !== "idle" && !answered && <StatusLine bot={AMY} state={step < 0 ? "thinking" : step === 0 ? "thinking" : "searching"} label={label} leaving={phase === "done"} />}
        {mode === "a" && phase !== "idle" && <SwapLine key={replayKey} reduced={reduced} done={phase === "done"} label={phase === "done" ? "Thought for 6s" : label} state={step <= 0 ? "thinking" : "searching"} />}
        {mode === "b" && phase !== "idle" && <PeekLine key={replayKey} speed={speed} reduced={reduced} done={phase === "done"} label={phase === "done" ? "Thought for 6s" : label ?? "Thinking"} />}
        {answered && (mode === "original"
          ? <Arrive reduced={reduced}><BotBubble>{ANSWER}</BotBubble></Arrive>
          : <Enter reduced={reduced} springy={mode === "b"}><BotBubble>{ANSWER}</BotBubble></Enter>)}
      </Transcript>
    </Stage>
  );
}

export function Enter({ children, reduced, springy = false, delay = 0 }: { children: ReactNode; reduced: boolean; springy?: boolean; delay?: number }) {
  return (
    <motion.div
      className="flex w-full flex-col items-start"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: springy ? 14 : offset.swapIn, scale: springy ? 0.96 : 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      style={{ originX: 0, originY: 1 }}
      transition={reduced ? { duration: dur.fast, delay } : springy ? { ...spring.enter, delay, opacity: { duration: dur.fast, delay } } : { duration: dur.swap, ease: ease.out, delay }}
    >
      {children}
    </motion.div>
  );
}

/** a label that swaps: the old one leaves up through a little blur, the new one rises in, the width springs to fit */
export function SwapLabel({ text, reduced, shimmer, className }: { text: string | null; reduced: boolean; shimmer: boolean; className?: string }) {
  const sizer = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | "auto">("auto");
  useLayoutEffect(() => { if (sizer.current) setWidth(sizer.current.offsetWidth); }, [text]);
  return (
    <motion.span className={cn("relative inline-grid h-[22px] items-center overflow-visible", className)} animate={{ width }} transition={reduced ? { duration: 0 } : spring.width}>
      <span ref={sizer} aria-hidden="true" className="invisible absolute whitespace-nowrap">{text}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        {text && (
          <motion.span
            key={text}
            className={cn("whitespace-nowrap [grid-area:1/1]", shimmer && "lab-shimmer")}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: offset.swapIn, filter: `blur(${offset.blurIn}px)` }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0, transition: { duration: dur.exit } } : { opacity: 0, y: offset.swapOut, filter: `blur(${offset.blurOut}px)`, transition: { duration: dur.exit, ease: ease.out } }}
            transition={{ duration: dur.swap, ease: ease.out }}
          >
            {text}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.span>
  );
}

function SwapLine({ label, done, reduced, state }: { label: string | null; done: boolean; reduced: boolean; state: "thinking" | "searching" }) {
  return (
    <motion.div
      className="flex h-9 items-center gap-[8.5px] ps-2 text-[14px] leading-[22px]"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{ originX: 0, originY: 0.5 }}
      transition={{ duration: dur.swap, ease: ease.out }}
    >
      <motion.span className="relative top-px inline-flex" animate={{ opacity: done ? 0 : 1, width: done ? 0 : 28, marginInlineEnd: done ? -8.5 : 0 }} transition={{ duration: dur.exit, ease: ease.out }}>
        <Mascot bot={AMY} size={28} state={state} />
      </motion.span>
      <span className={cn(done ? "text-ink-tertiary" : "text-ink-secondary", "inline-flex items-center gap-1")}>
        <SwapLabel text={label} reduced={reduced} shimmer={!done} />
        {done && <ChevronRight size={13} className="text-ink-tertiary" />}
      </span>
    </motion.div>
  );
}

/** B: the line carries a live two-line peek at the reasoning that steps up every 840ms; done, it folds into "Thought for 6s" */
function PeekLine({ label, done, reduced, speed }: { label: string; done: boolean; reduced: boolean; speed: number }) {
  const [line, setLine] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => setLine((n) => Math.min(n + 1, REASONING.length - 2)), ms(840, speed));
    return () => clearInterval(timer);
  }, [done, speed]);
  const peek = !done || open;
  return (
    <div className="flex flex-col items-start ps-2">
      <button
        type="button"
        disabled={!done}
        aria-expanded={done ? open : undefined}
        onClick={() => setOpen((v) => !v)}
        className="-ms-1.5 flex h-9 items-center gap-[8.5px] rounded-[10px] px-1.5 text-[14px] leading-[22px] outline-none transition-colors duration-[120ms] enabled:hover:bg-ink/[0.045] focus-visible:ring-2 focus-visible:ring-focus"
      >
        <motion.span className="relative top-px inline-flex" animate={{ opacity: done ? 0 : 1, width: done ? 0 : 28, marginInlineEnd: done ? -8.5 : 0 }} transition={{ duration: dur.exit, ease: ease.out }}>
          <Mascot bot={AMY} size={28} state="thinking" />
        </motion.span>
        <span className={cn(done ? "text-ink-tertiary" : "text-ink-secondary", "inline-flex items-center gap-1")}>
          <SwapLabel text={label} reduced={reduced} shimmer={!done} />
          {done && (
            <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1, rotate: open ? 90 : 0 }} transition={{ duration: dur.fast, ease: ease.out }} className="inline-flex">
              <ChevronRight size={13} />
            </motion.span>
          )}
        </span>
      </button>
      <motion.div
        className="overflow-hidden ps-[36.5px]"
        initial={false}
        animate={{ height: peek ? (done ? REASONING.length * 20 + 4 : 40) : 0, opacity: peek ? 1 : 0 }}
        transition={reduced ? { duration: 0, opacity: { duration: dur.fast } } : { height: spring.height, opacity: { duration: dur.fast } }}
      >
        <div
          className="relative overflow-hidden text-[13px] leading-5 text-ink-tertiary"
          style={{ height: done ? "auto" : 40, maskImage: done ? undefined : "linear-gradient(transparent, #000 35%, #000 70%, transparent)" }}
        >
          <motion.div
            animate={{ y: done ? 0 : -line * 20 }}
            transition={reduced ? { duration: 0 } : { duration: dur.d500, ease: ease.inOut }}
          >
            {REASONING.map((text) => <div key={text} className="max-w-[300px] truncate">{text}</div>)}
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

export const thinking: Item = {
  id: "thinking",
  title: "Thinking and reasoning state",
  surface: "chat",
  height: 300,
  loopMs: 7600,
  notes: {
    original: "Line grows from its edge (scale .92, 180ms) as the mascot pops from .6 (340ms back-ease); words come 1.8-2.6s later, each step rises 4px / 180ms with a shimmer stepped 60x over 2.2s; leaves in 140ms, then the reply rises 12px.",
    a: "Same honest timing. Labels swap: old up 6px + 2px blur 120ms, new up from 8px / 4px blur 200ms; width springs 380/24 so nothing jumps; smooth 2s shimmer. Done: mascot folds away, line settles to a quiet \"Thought for 6s\"; reply fades up 8px 200ms.",
    b: "A's swaps plus a live two-line peek of the reasoning stepping every 840ms (500ms in-out, masked edges; transitions.dev idea, rebuilt). Done: peek folds on spring 300/22 into \"Thought for 6s\", click to open it all; reply enters on 300/22 from 14px and .96.",
  },
  Original: (p) => <Thinking {...p} mode="original" />,
  A: (p) => <Thinking {...p} mode="a" />,
  B: (p) => <Thinking {...p} mode="b" />,
};
