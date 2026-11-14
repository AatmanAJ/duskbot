import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import type { Item, LabProps } from "@lab/types";
import { dur, ease, offset, spring } from "@lab/tokens";
import { JumpToLatestButton } from "@/components/JumpToLatestButton";
import { Icon } from "@/components/Icon";
import { BotBubble, Row, Stage, UserBubble, useScript } from "../kit";
import { Arrive } from "../shipped";

const HISTORY: Array<["me" | "bot", string]> = [
  ["me", "plan saturday for me"], ["bot", "Flight at 6:10, cab booked for 4:45."], ["me", "and lunch?"],
  ["bot", "Table for two at Gunpowder, 1:30."], ["me", "beach after?"], ["bot", "Ashwem is quiet around 4. Sunset is 6:12."],
  ["me", "perfect"], ["bot", "I'll send the plan to Priya too."], ["me", "thanks amy"], ["bot", "Anytime. Pack sunscreen."],
];
type Mode = "original" | "a" | "b";

function Jump({ replayKey, speed, reduced, mode }: LabProps & { mode: Mode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [extra, setExtra] = useState<string[]>([]);
  const [unseen, setUnseen] = useState(0);
  const followingRef = useRef(true);
  followingRef.current = following;
  const toEnd = (smooth: boolean) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduced ? "smooth" : "auto" });
  };
  const jump = () => { setUnseen(0); toEnd(true); };
  useScript(replayKey, speed, [
    [0, () => { setExtra([]); setUnseen(0); requestAnimationFrame(() => toEnd(false)); }],
    [400, () => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })],
    [1700, () => { setExtra(["Heads up: the cab is 10 min early."]); }],
    [3000, jump],
  ]);
  useEffect(() => {
    if (extra.length && !followingRef.current) setUnseen((n) => n + 1);
    else if (extra.length) toEnd(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extra.length]);
  const onScroll = () => {
    const el = scroller.current!;
    const at = el.scrollHeight - el.clientHeight - el.scrollTop < 40;
    setFollowing(at);
    if (at) setUnseen(0);
  };

  return (
    <Stage>
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 [overflow-anchor:none] [scrollbar-width:none]">
        <div className="flex flex-col gap-4 pt-4 pb-14">
          {HISTORY.map(([who, text], i) => <Row key={i} side={who === "me" ? "end" : "start"}>{who === "me" ? <UserBubble>{text}</UserBubble> : <BotBubble>{text}</BotBubble>}</Row>)}
          {extra.map((text) => <Arrive key={text} reduced><BotBubble>{text}</BotBubble></Arrive>)}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        {mode === "original" ? (
          !following && <div className="pointer-events-auto relative h-8 w-8"><JumpToLatestButton onClick={jump} className="bottom-0" /></div>
        ) : (
          <AnimatePresence>
            {!following && (
              <motion.div
                key="jump"
                className="pointer-events-auto"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0, transition: { duration: dur.exit } } : { opacity: 0, y: 4, transition: { duration: dur.exit, ease: ease.out } }}
                transition={{ duration: dur.fast, ease: ease.out }}
              >
                {mode === "a" ? <PlainJump onClick={jump} /> : <CountJump onClick={jump} unseen={unseen} reduced={reduced} />}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </Stage>
  );
}

const JUMP = "flex h-8 items-center justify-center rounded-full bg-composer text-ink shadow-[0_1px_3px_rgb(28_28_28/0.12)] transition-colors duration-[120ms] ease-out hover:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function PlainJump({ onClick }: { onClick: () => void }) {
  return (
    <motion.button type="button" aria-label="Jump to latest" onClick={onClick} whileTap={{ scale: offset.pressScale }} transition={{ duration: dur.press }} className={`${JUMP} w-8`}>
      <Icon name="arrow-down" size={16} />
    </motion.button>
  );
}

/** B: new words while you read further up turn the round button into a "1 new" pill; the arrow nods once per arrival */
function CountJump({ onClick, unseen, reduced }: { onClick: () => void; unseen: number; reduced: boolean }) {
  const arrow = useAnimationControls();
  useEffect(() => {
    if (unseen > 0 && !reduced) void arrow.start({ y: [0, 3, 0], transition: { duration: dur.settle, ease: ease.inOut } });
  }, [unseen, reduced, arrow]);
  return (
    <motion.button
      type="button"
      aria-label={unseen ? `Jump to latest, ${unseen} new` : "Jump to latest"}
      onClick={onClick}
      whileTap={{ scale: offset.pressScale }}
      layout
      transition={reduced ? { duration: 0 } : { layout: spring.width, scale: { duration: dur.press } }}
      className={`${JUMP} gap-1.5 px-2`}
      style={{ borderRadius: 999 }}
    >
      <motion.span layout="position" animate={arrow} className="inline-flex"><Icon name="arrow-down" size={16} /></motion.span>
      <AnimatePresence mode="popLayout" initial={false}>
        {unseen > 0 && (
          <motion.span
            key="count"
            layout="position"
            className="pe-1 text-[13px] leading-5 whitespace-nowrap text-ink-secondary"
            initial={{ opacity: 0, filter: `blur(${offset.blurOut}px)` }}
            animate={{ opacity: 1, filter: "blur(0px)", transition: { duration: dur.swap, ease: ease.out, delay: 0.06 } }}
            exit={{ opacity: 0, transition: { duration: dur.exit } }}
          >
            {unseen} new
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export const jump: Item = {
  id: "jump-to-latest",
  title: "Scroll-to-bottom button",
  surface: "chat",
  height: 300,
  loopMs: 4200,
  notes: {
    original: "Real JumpToLatestButton: rises 6px with a fade over 150ms cubic-bezier(.2,0,0,1) when you scroll up; vanishes in one frame when you're back; click scrolls smooth.",
    a: "Same 150ms rise in, plus a 120ms exit (fade, 4px down) so it never blinks out, and a .97 press.",
    b: "A, and while you read higher up, new words grow it into a \"1 new\" pill (width on 380/24, count fades from 2px blur +60ms) and the arrow nods 3px once (320ms in-out) per arrival.",
  },
  Original: (p) => <Jump {...p} mode="original" />,
  A: (p) => <Jump {...p} mode="a" />,
  B: (p) => <Jump {...p} mode="b" />,
};
