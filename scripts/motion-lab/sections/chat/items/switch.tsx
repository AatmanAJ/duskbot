import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, offset, spring } from "@lab/tokens";
import { BOTS, BotBubble, cn, Composer, Mascot, Row, Stage, Transcript, UserBubble, useScript, type LabBot } from "../kit";

const THREADS: Record<string, Array<["me" | "bot", string]>> = {
  amy: [["me", "anything new on the goa trip?"], ["bot", "IndiGo dropped to ₹4,280. Want me to hold it?"]],
  writer: [["bot", "Draft two is ready. I cut the intro to two lines."], ["me", "nice, send it to Amy too"]],
  pepper: [["me", "remind me about rent on the 1st"], ["bot", "Done. I'll ping you at 9 that morning."]],
};

type Mode = "original" | "a" | "b";

function Switcher({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [active, setActive] = useState(0);
  useScript(replayKey, speed, [[0, () => setActive(0)], [900, () => setActive(1)], [1900, () => setActive(2)], [2800, () => setActive(0)]]);
  const bot = BOTS[active]!;
  return (
    <Stage className="flex-row">
      <nav aria-label="Bots" className="relative flex w-[132px] shrink-0 flex-col gap-0.5 bg-ink/[0.025] p-2">
        {mode === "b" && <StretchHighlight index={active} reduced={reduced} />}
        {BOTS.map((one, index) => (
          <button
            key={one.id}
            type="button"
            onClick={() => setActive(index)}
            aria-current={index === active ? "page" : undefined}
            className={cn(
              "relative z-[1] flex h-9 items-center gap-2 rounded-[10px] px-2 text-[13px] text-ink-secondary outline-none focus-visible:ring-2 focus-visible:ring-focus aria-[current]:text-ink",
              mode !== "b" && "aria-[current]:bg-ink/[0.07] hover:bg-ink/[0.045]",
            )}
          >
            <Mascot bot={one} size={20} animated={false} />
            {one.name}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center gap-2 px-4 text-[14px] font-medium">
          {mode === "original" ? (
            <><Mascot bot={bot} size={22} animated={false} /><span>{bot.name}</span></>
          ) : (
            <SwapTitle bot={bot} reduced={reduced} />
          )}
        </header>
        {/* the transcript swaps in the same frame in every column: chat switching is frequent, so it never animates */}
        <Transcript key={bot.id}>
          {THREADS[bot.id]!.map(([who, text], i) => (
            <Row key={i} side={who === "me" ? "end" : "start"}>
              {who === "me" ? <UserBubble bot={bot}>{text}</UserBubble> : <BotBubble>{text}</BotBubble>}
            </Row>
          ))}
        </Transcript>
        <Composer value="" placeholder={`Message ${bot.name}`} bot={bot} />
      </div>
    </Stage>
  );
}

/** the header's name and mascot: the old one leaves up through a little blur, the new one rises in */
function SwapTitle({ bot, reduced }: { bot: LabBot; reduced: boolean }) {
  return (
    <span className="relative grid">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={bot.id}
          className="flex items-center gap-2 [grid-area:1/1]"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: offset.swapIn, filter: `blur(${offset.blurIn}px)` }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0, transition: { duration: dur.exit } } : { opacity: 0, y: offset.swapOut, filter: `blur(${offset.blurOut}px)`, transition: { duration: dur.exit, ease: ease.out } }}
          transition={{ duration: reduced ? dur.fast : dur.swap, ease: ease.out }}
        >
          <Mascot bot={bot} size={22} animated={false} />
          <span>{bot.name}</span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** the active row's plate stretches toward the new row: its leading edge is stiff, the trailing edge catches up */
function StretchHighlight({ index, reduced }: { index: number; reduced: boolean }) {
  const top = 8 + index * 38;
  const last = useRef(index);
  const down = index >= last.current;
  useEffect(() => { last.current = index; }, [index]);
  const lead = reduced ? { duration: 0 } : spring.lead;
  const trail = reduced ? { duration: 0 } : spring.trail;
  return (
    <motion.span
      aria-hidden="true"
      className="absolute inset-x-2 rounded-[10px] bg-ink/[0.07]"
      initial={false}
      animate={{ top, bottom: `calc(100% - ${top + 36}px)` }}
      transition={{ top: down ? trail : lead, bottom: down ? lead : trail }}
    />
  );
}

export const chatSwitch: Item = {
  id: "chat-switch",
  title: "Chat switch (bot to bot)",
  surface: "chat",
  height: 300,
  loopMs: 3600,
  notes: {
    original: "Hard cut. ChatView remounts on the thread (ChatView.tsx:1440 key), rows never replay; the sidebar plate jumps.",
    a: "Transcript still instant (0ms, frequent action). Only the header name swaps: old leaves up 6px + 2px blur in 120ms, new rises 8px from 4px blur in 200ms ease.out.",
    b: "A's header swap plus the sidebar plate stretching to the new bot: leading edge spring 620/36, trailing edge 190/19 (DesignBookmark recipe, rebuilt). Transcript instant.",
  },
  Original: (p) => <Switcher {...p} mode="original" />,
  A: (p) => <Switcher {...p} mode="a" />,
  B: (p) => <Switcher {...p} mode="b" />,
};
