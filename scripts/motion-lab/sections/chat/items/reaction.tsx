import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, spring } from "@lab/tokens";
import { BotBubble, Controls, LabButton, Row, Stage, Transcript, UserBubble, cn, useScript } from "../kit";

type Mode = "original" | "a" | "b";
const PILL = "chat-reaction-pill composer-press flex h-[30px] items-center rounded-full bg-composer px-[7px] text-[12px] leading-4 text-ink/[0.68] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function Reaction({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [on, setOn] = useState(false);
  useScript(replayKey, speed, [[0, () => setOn(false)], [500, () => setOn(true)]]);
  const pill = (
    <button type="button" aria-pressed aria-label="Loved by you" onClick={() => setOn(false)} className={cn(PILL, mode === "original" && !reduced && "chat-reaction-pop")}>
      <span aria-hidden="true" className="text-[16px] leading-4">❤️</span>
    </button>
  );
  return (
    <Stage>
      <Controls><LabButton onClick={() => setOn((v) => !v)} pressed={on}>Love it</LabButton></Controls>
      <Transcript>
        <Row side="end"><UserBubble>book the indigo one</UserBubble></Row>
        <Row side="start" className="pt-[26px]">
          <div className="relative" data-reacted="">
            <BotBubble>Booked. PNR QX7T2M, it's in your email.</BotBubble>
            <div className="absolute -end-4 -top-[22px] z-[1]">
              {mode === "original" ? on && pill : (
                <AnimatePresence>
                  {on && (
                    <motion.div
                      key="love"
                      style={{ originX: 0.3, originY: 1 }}
                      initial={reduced ? { opacity: 0 } : mode === "a" ? { opacity: 0, scale: 0.9 } : { opacity: 0, scale: 0.85, rotate: -8 }}
                      animate={{ opacity: 1, scale: 1, rotate: 0 }}
                      exit={reduced ? { opacity: 0, transition: { duration: dur.exit } } : { opacity: 0, scale: 0.9, transition: { duration: dur.exit, ease: ease.out } }}
                      transition={reduced ? { duration: dur.fast } : mode === "a" ? { duration: dur.fast, ease: ease.out } : { ...spring.pop, opacity: { duration: dur.fast } }}
                    >
                      {pill}
                    </motion.div>
                  )}
                </AnimatePresence>
              )}
            </div>
          </div>
        </Row>
      </Transcript>
    </Stage>
  );
}

export const reaction: Item = {
  id: "reaction-tapback",
  title: "Reaction tapback on a bubble",
  surface: "chat",
  height: 220,
  loopMs: 2000,
  notes: {
    original: "Grok's tapback pops from scale .6 over 500ms on a linear() spring that peaks at 1.078 (chat.css .chat-reaction-pop); removing it is instant. Breaks the 0.9+ rule.",
    a: "Fades in from .9 over 150ms ease.out, anchored at its corner; leaves in 120ms (fade, .9).",
    b: "Pops from .85 with an 8° tilt on the calm pop spring 520/26, anchored on the bubble; leaves in 120ms. Direct acknowledgement, so the one place a pop belongs.",
  },
  Original: (p) => <Reaction {...p} mode="original" />,
  A: (p) => <Reaction {...p} mode="a" />,
  B: (p) => <Reaction {...p} mode="b" />,
};
