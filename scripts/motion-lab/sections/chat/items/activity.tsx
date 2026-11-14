import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, offset, spring, timing } from "@lab/tokens";
import { EventChip, EventLabel, EventLine } from "@/components/EventLine";
import { AMY, BotBubble, Mascot, Row, Stage, Transcript, UserBubble, WRITER, useScript, type LabBot } from "../kit";
import { Arrive } from "../shipped";

type Mode = "original" | "a" | "b";

const ROWS: Array<{ at: number; kind: "line" | "bubble"; label?: string; bot?: LabBot; text?: string }> = [
  { at: 250, kind: "line", label: "Messaged", bot: AMY },
  { at: 550, kind: "bubble", text: "What's the cheapest Goa fare this weekend?" },
  { at: 1500, kind: "line", label: "Message from", bot: AMY },
  { at: 1800, kind: "bubble", text: "IndiGo, Saturday 6:10, ₹4,280 return." },
  { at: 2700, kind: "line", label: "Created", bot: WRITER },
];

function Activity({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const [count, setCount] = useState(0);
  useScript(replayKey, speed, [[0, () => setCount(0)], ...ROWS.map((row, i): [number, () => void] => [row.at, () => setCount(i + 1)])]);
  return (
    <Stage>
      <Transcript>
        <Row side="end"><UserBubble>ask Amy for the fare, then make me a writer bot</UserBubble></Row>
        {ROWS.slice(0, count).map((row, i) => {
          const body = row.kind === "line"
            ? <Line mode={mode} reduced={reduced} label={row.label!} bot={row.bot!} />
            : <BotBubble>{row.text}</BotBubble>;
          if (mode === "original") return <Arrive key={i} reduced={reduced} className={row.kind === "line" ? "items-center" : undefined}>{body}</Arrive>;
          if (row.kind === "line") return <div key={i} className="w-full">{body}</div>;
          return (
            <motion.div key={i} className="flex w-full flex-col items-start" initial={reduced ? { opacity: 0 } : { opacity: 0, y: offset.swapIn }} animate={{ opacity: 1, y: 0 }} transition={mode === "b" && !reduced ? { ...spring.enter, opacity: { duration: dur.fast } } : { duration: dur.swap, ease: ease.out }}>
              {body}
            </motion.div>
          );
        })}
      </Transcript>
    </Stage>
  );
}

function Line({ mode, reduced, label, bot }: { mode: Mode; reduced: boolean; label: string; bot: LabBot }) {
  const chip = <EventChip wideGap title={bot.name} leading={<Mascot bot={bot} size={16} state="happy" animated={false} />}>{bot.name}</EventChip>;
  if (mode === "original") return <EventLine><EventLabel>{label}</EventLabel>{chip}</EventLine>;
  const lag = timing.contentLag / 1000;
  return (
    <EventLine>
      <motion.span
        className="inline-flex"
        initial={reduced ? { opacity: 0 } : mode === "a" ? { opacity: 0, y: 6 } : { opacity: 0, y: offset.swapIn, filter: `blur(${offset.blurIn}px)` }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: dur.swap, ease: ease.out }}
      >
        <EventLabel>{label}</EventLabel>
      </motion.span>
      <Pop mode={mode} reduced={reduced} lag={lag}>{chip}</Pop>
    </EventLine>
  );
}

/** the named thing follows its words 80ms later: A fades it, B pops it from .9 on the calm pop spring */
function Pop({ children, mode, reduced, lag }: { children: ReactNode; mode: Mode; reduced: boolean; lag: number }) {
  return (
    <motion.span
      className="inline-flex"
      initial={reduced ? { opacity: 0 } : mode === "a" ? { opacity: 0, y: 6 } : { opacity: 0, scale: 0.9, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={reduced ? { duration: dur.fast, delay: lag } : mode === "a" ? { duration: dur.swap, ease: ease.out, delay: lag } : { ...spring.pop, delay: lag, opacity: { duration: dur.fast, delay: lag } }}
    >
      {children}
    </motion.span>
  );
}

export const activity: Item = {
  id: "activity-lines",
  title: "Quiet centred activity lines (Messaged Amy, Created Writer)",
  surface: "chat",
  height: 340,
  loopMs: 4200,
  notes: {
    original: "EventLine (centred 12/16, chip with the bot's 16px mascot) arrives like any row: the whole line rises 12px over 240ms, no fade. Bubbles under it the same.",
    a: "The words fade up 6px in 200ms ease.out; the chip follows 80ms later the same way (container first, content after). Bubbles fade up 8px / 200ms.",
    b: "The words condense in (8px, 4px blur, 200ms); the chip pops from .9 on 520/26 80ms later, so the bot's mascot is the beat. Bubbles enter on 300/22.",
  },
  Original: (p) => <Activity {...p} mode="original" />,
  A: (p) => <Activity {...p} mode="a" />,
  B: (p) => <Activity {...p} mode="b" />,
};
