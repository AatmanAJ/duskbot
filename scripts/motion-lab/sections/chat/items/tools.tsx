import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, offset, spring, stagger } from "@lab/tokens";
import { Check, ChevronRight } from "@/icons";
import { RUN_TOGGLE } from "@/components/ActivityRun";
import { WorkingDots } from "@/components/WorkingIndicator";
import { BotBubble, Row, Stage, Transcript, UserBubble, cn, useScript } from "../kit";
import { Arrive } from "../shipped";
import { Enter, SwapLabel } from "./thinking";

const STEPS = ["Searched flights to Goa", "Opened makemytrip.com", "Compared 3 fares"];
const SUMMARY = "Searched the web, opened a page, compared 3 fares";
type Mode = "original" | "a" | "b";

function Tools({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [shown, setShown] = useState(0);
  const [finished, setFinished] = useState(0);
  const [folded, setFolded] = useState(false);
  const [open, setOpen] = useState(false);
  const [answered, setAnswered] = useState(false);
  const foldAt = mode === "b" ? 4100 : 3300;
  useScript(replayKey, speed, [
    [0, () => { setShown(1); setFinished(0); setFolded(false); setOpen(false); setAnswered(false); }],
    [1100, () => { setFinished(1); setShown(2); }],
    [2200, () => { setFinished(2); setShown(3); }],
    [3100, () => setFinished(3)],
    [foldAt, () => setFolded(true)],
    [foldAt + 200, () => setAnswered(true)],
  ]);
  const steps = STEPS.slice(0, shown);
  const listOpen = !folded || open;

  return (
    <Stage>
      <Transcript>
        <Row side="end"><UserBubble>cheapest flight to goa this weekend?</UserBubble></Row>
        {mode === "original" ? (
          folded ? (
            <div className="flex flex-col gap-1">
              <div className="flex min-w-0 justify-start">
                <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={RUN_TOGGLE}>
                  {open ? <ChevronRight size={13} className="shrink-0 rotate-90" /> : <Check size={13} aria-hidden="true" className="shrink-0 text-success" />}
                  <span className="min-w-0 truncate leading-5">{SUMMARY}</span>
                  {!open && <ChevronRight size={13} className="shrink-0" />}
                </button>
              </div>
              {open && STEPS.map((label) => <ShippedChip key={label} label={label} done />)}
            </div>
          ) : (
            steps.map((label, i) => <Arrive key={label} reduced={reduced}><ShippedChip label={label} done={i < finished} /></Arrive>)
          )
        ) : (
          <div className="flex flex-col items-start gap-1">
            <AnimatePresence initial={false}>
              {(folded || mode === "b") && (
                <motion.div key="head" initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: dur.swap, ease: ease.out }}>
                  <button type="button" aria-expanded={listOpen} disabled={!folded} onClick={() => setOpen((v) => !v)} className={cn(RUN_TOGGLE, "disabled:cursor-default")}>
                    <motion.span className="inline-flex shrink-0" animate={{ rotate: listOpen && folded ? 90 : 0 }} transition={{ duration: dur.fast, ease: ease.out }}>
                      {folded ? <ChevronRight size={13} /> : <WorkingDots size={3} />}
                    </motion.span>
                    {mode === "b" ? (
                      <SwapLabel reduced={reduced} shimmer={!folded} className="text-[13px]" text={finished === 3 ? "Worked for 8s · 3 steps" : `Working · step ${shown} of 3`} />
                    ) : (
                      <span className="min-w-0 truncate leading-5">{SUMMARY}</span>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
            <motion.div
              className="w-full overflow-hidden"
              initial={false}
              animate={{ height: listOpen ? "auto" : 0, opacity: listOpen ? 1 : 0 }}
              transition={reduced ? { duration: 0, opacity: { duration: dur.fast } } : mode === "b" ? { height: spring.height, opacity: { duration: dur.fast } } : { duration: dur.expand, ease: ease.out }}
            >
              <div className="relative flex flex-col gap-1 pb-0.5">
                {mode === "b" && <Rail count={steps.length} reduced={reduced} />}
                {steps.map((label, i) => <StepChip key={label} label={label} done={i < finished} reduced={reduced} draw={mode === "b"} index={i} />)}
              </div>
            </motion.div>
          </div>
        )}
        {answered && (mode === "original"
          ? <Arrive reduced={reduced}><BotBubble>IndiGo on Saturday, ₹4,280 return. Hold it?</BotBubble></Arrive>
          : <Enter reduced={reduced} springy={mode === "b"}><BotBubble>IndiGo on Saturday, ₹4,280 return. Hold it?</BotBubble></Enter>)}
      </Transcript>
    </Stage>
  );
}

/** ToolActivity's closed summary: dots while live, a check once done, swapped in place */
function ShippedChip({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex min-h-8 w-fit items-center gap-2 rounded-xl bg-panel px-3 py-1.5 text-[13px]">
      <span className="shrink-0" aria-hidden="true">{done ? <Check size={13} className="text-success" /> : <WorkingDots size={3.5} />}</span>
      <span className="font-medium leading-5">{label}</span>
      <ChevronRight size={13} className="ml-auto shrink-0" aria-hidden="true" />
    </div>
  );
}

function StepChip({ label, done, reduced, draw, index }: { label: string; done: boolean; reduced: boolean; draw: boolean; index: number }) {
  return (
    <motion.div
      className="relative flex min-h-8 w-fit items-center gap-2 rounded-xl bg-panel px-3 py-1.5 text-[13px]"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: done ? 0.75 : 1, y: 0 }}
      transition={{ duration: dur.swap, ease: ease.out, delay: index === 0 ? 0 : stagger.in }}
    >
      <span className="relative grid size-[13px] shrink-0 place-items-center" aria-hidden="true">
        <AnimatePresence mode="popLayout" initial={false}>
          {done ? (
            <motion.span key="done" className="text-success [grid-area:1/1]" initial={{ opacity: 0, filter: `blur(${offset.blurOut}px)`, scale: draw ? 0.9 : 1 }} animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }} transition={draw && !reduced ? { ...spring.pop, opacity: { duration: 0.18 } } : { duration: 0.18, ease: ease.quint }}>
              {draw && !reduced ? <DrawnCheck /> : <Check size={13} />}
            </motion.span>
          ) : (
            <motion.span key="live" className="[grid-area:1/1]" exit={{ opacity: 0, filter: `blur(${offset.blurOut}px)`, transition: { duration: dur.exit } }}>
              <span className="lab-spin block size-[11px] rounded-full border-[1.5px] border-ink/20 border-t-ink/70" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className={cn("font-medium leading-5", !done && "lab-shimmer")}>{label}</span>
    </motion.div>
  );
}

function DrawnCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <motion.path d="M3.5 8.5 6.5 11.5 12.5 4.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, ease: ease.quint, delay: 0.05 }} />
    </svg>
  );
}

/** B: a hairline joins the step icons, growing down from the first as steps arrive */
function Rail({ count, reduced }: { count: number; reduced: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      className="absolute start-[18px] top-4 w-px origin-top bg-ink/15"
      initial={false}
      animate={{ height: Math.max(0, (count - 1) * 36) }}
      transition={reduced ? { duration: 0 } : { duration: 0.5, ease: ease.out }}
    />
  );
}

export const tools: Item = {
  id: "tool-calls",
  title: "Tool-call cards (steps while working, folded run after)",
  surface: "chat",
  height: 340,
  loopMs: 5600,
  notes: {
    original: "With tool calls shown: each step's card rises 12px / 240ms; its stepped dots swap to a check in one frame. When the turn ends the run is one quiet line (ActivityRun); opening and closing it is instant.",
    a: "Cards enter opacity + 4px over 200ms (45ms after the one before); spinner (0.8s) leaves through 2px blur in 120ms as the check fades in 180ms; running label shimmers. On finish the list folds over 250ms ease.out into the summary line, which then opens and closes the same way (chevron 150ms).",
    b: "A, plus a live header that says the step count (labels swap with blur, width springs), a hairline rail that grows 500ms between icons, and checks that pop (520/26) as they draw (300ms). Header becomes \"Worked for 8s · 3 steps\" and folds 1s after the last step on spring 300/22. AI Elements Tool / Kokonut agent steps, rebuilt.",
  },
  Original: (p) => <Tools {...p} mode="original" />,
  A: (p) => <Tools {...p} mode="a" />,
  B: (p) => <Tools {...p} mode="b" />,
};
