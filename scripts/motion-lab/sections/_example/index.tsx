import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MausAvatar } from "@/components/Avatar";
import { dur, ease, offset, spring } from "@lab/tokens";
import type { LabProps, Section } from "@lab/types";

// the pattern: default-export a Section. each column is a component taking LabProps; key the part that should
// replay on replayKey. motion and css are slowed globally, so only your own timers need `ms(value, speed)`.

function Card({ replayKey, children }: LabProps & { children: React.ReactNode }) {
  return (
    <div key={replayKey} className="flex h-full flex-col items-center justify-center gap-3">
      {children}
    </div>
  );
}

function Original(props: LabProps) {
  // today: the bubble appears with no motion
  return (
    <Card {...props}>
      <MausAvatar color="green" size={44} label="dusk bot" />
      <div className="rounded-2xl bg-card px-4 py-2.5 text-[15px] text-ink">hey, I'm on it</div>
    </Card>
  );
}

function A(props: LabProps) {
  // calm: rise 8px with a little blur on the default ease
  return (
    <Card {...props}>
      <MausAvatar color="green" size={44} label="dusk bot" />
      <motion.div
        initial={props.reduced ? { opacity: 0 } : { opacity: 0, y: offset.swapIn, filter: `blur(${offset.blurIn}px)` }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: dur.swap, ease: ease.out }}
        className="rounded-2xl bg-card px-4 py-2.5 text-[15px] text-ink"
      >
        hey, I'm on it
      </motion.div>
    </Card>
  );
}

function B(props: LabProps) {
  // alive: grows from the mascot on the enter spring; click to toggle it (interactive like the real thing)
  const [open, setOpen] = useState(true);
  return (
    <Card {...props}>
      <button type="button" aria-label="toggle the reply" onClick={() => setOpen((v) => !v)} className="rounded-full">
        <MausAvatar color="green" size={44} label="dusk bot" />
      </button>
      <div className="h-11">
        <AnimatePresence initial={true}>
          {open && (
            <motion.div
              style={{ transformOrigin: "50% 0%" }}
              initial={props.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={props.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: dur.exit, ease: ease.out } }}
              transition={spring.enter}
              className="rounded-2xl bg-card px-4 py-2.5 text-[15px] text-ink"
            >
              hey, I'm on it
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}

const section: Section = {
  id: "_example",
  title: "example",
  order: 999,
  items: [
    {
      id: "reply-arrives",
      title: "reply arrives",
      surface: "chat",
      notes: {
        original: "no motion: the bubble is just there",
        a: "rise 8px + blur 4px to 0, 200ms ease.out",
        b: "grows from the mascot on spring.enter 300/22, click the mascot to toggle; exit 120ms",
      },
      Original,
      A,
      B,
      height: 220,
    },
  ],
};

export default section;
