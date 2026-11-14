import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { dur, ease, spring } from "@lab/tokens";
import type { LabProps } from "@lab/types";
import "@/components/chat.css";
import { useLater, useScript } from "./kit";

const REACTIONS = ["👍", "❤️", "😂", "🎉"] as const;
type Reaction = (typeof REACTIONS)[number];
const NAMES: Record<Reaction, string> = { "👍": "thumbs up", "❤️": "heart", "😂": "laughing", "🎉": "party" };

/** copy (resets after `resetMs`), open the reaction row, pick one */
function useActionsDemo({ replayKey, speed }: LabProps, resetMs: number, closeDelay = 0) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<Reaction | null>(null);
  const [picking, setPicking] = useState<Reaction | null>(null);
  const later = useLater(speed);
  const reset = useRef<(() => void) | null>(null);
  const copy = () => {
    setCopied(true);
    reset.current?.();
    reset.current = later(resetMs, () => setCopied(false));
  };
  const react = (emoji: Reaction) => {
    setPicking(emoji);
    later(closeDelay, () => {
      setMine((current) => (current === emoji ? null : emoji));
      setOpen(false);
      setPicking(null);
    });
  };
  const stop = useScript(replayKey, speed, [[600, copy], [2200, () => setOpen(true)], [700, () => react("👍")]], () => { setCopied(false); setOpen(false); setMine(null); });
  return {
    copied, open, mine, picking,
    copy: () => { stop(); copy(); },
    toggleOpen: () => { stop(); setOpen((v) => !v); },
    react: (emoji: Reaction) => { stop(); react(emoji); },
  };
}
type Demo = ReturnType<typeof useActionsDemo>;

const ACTION = "dusk-press relative inline-flex h-6 min-w-6 items-center justify-center rounded-[8px] text-ink-secondary hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

function Message({ demo, copyButton, picker, chip }: { demo: Demo; copyButton: React.ReactNode; picker: React.ReactNode; chip: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col justify-center px-5">
      <div className="relative max-w-[280px]">
        <div className="rounded-[18px] bg-card px-3.5 py-2.5 text-[14px] leading-5 text-ink">
          Booked: Thursday 10:00 with Priya, and the launch update is drafted in your notes.
        </div>
        <div className="absolute -bottom-[18px] start-3 z-[1]">{chip}</div>
      </div>
      <div className="relative mt-6 flex items-center gap-0.5">
        {copyButton}
        <div className="relative">
          <button type="button" aria-label="react" aria-expanded={demo.open} onClick={demo.toggleOpen} className={cn(ACTION, demo.open && "bg-ink/[0.06]")}>
            <Icon name="smiley-happy" size={14} />
          </button>
          {picker}
        </div>
        <button type="button" aria-label="reply" className={ACTION}><Icon name="arrow-u-up-left" size={14} /></button>
      </div>
    </div>
  );
}

const PICKER = "popover-surface absolute start-0 top-full z-40 mt-1 flex items-center gap-1 rounded-full bg-menu p-1.5 shadow-(--shadow-popover)";

function PickerRow({ demo, lively }: { demo: Demo; lively?: boolean }) {
  return (
    <>
      {REACTIONS.map((emoji) => (
        <motion.button key={emoji} type="button" aria-pressed={demo.mine === emoji} aria-label={NAMES[emoji]} onClick={() => demo.react(emoji)}
          animate={lively && demo.picking === emoji ? { scale: [1, 1.18, 1], transition: { duration: 0.32, ease: ease.out } } : undefined}
          className={cn("flex size-8 items-center justify-center rounded-full text-[20px] leading-none hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", demo.mine === emoji && "bg-ink/[0.08]")}>
          <span aria-hidden>{emoji}</span>
        </motion.button>
      ))}
    </>
  );
}

const CHIP = "chat-reaction-pill flex h-[30px] items-center rounded-full bg-composer px-[7px] text-[12px] leading-4 text-ink/[0.68]";

/* ---------------- Original ---------------- */

export function ActionsOriginal(props: LabProps) {
  const demo = useActionsDemo(props, 1200);
  return (
    <Message demo={demo}
      copyButton={(
        <button type="button" onClick={demo.copy} aria-label={demo.copied ? "copied" : "copy message"} className={ACTION}>
          {demo.copied ? <Icon name="check" size={16} className="text-success" /> : <Icon name="copy" size={16} />}
        </button>
      )}
      picker={demo.open && <div role="toolbar" aria-label="reactions" className={cn(PICKER, "animate-pop-in origin-top-left")}><PickerRow demo={demo} /></div>}
      chip={demo.mine && <button key={demo.mine} type="button" aria-label={`${NAMES[demo.mine]}, you`} onClick={() => demo.react(demo.mine!)} className={cn(CHIP, "chat-reaction-pop composer-press")}><span className="text-[16px] leading-4">{demo.mine}</span></button>} />
  );
}

/* ---------------- A: calm ---------------- */

function SwapIcon({ on }: { on: boolean }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span key={on ? "check" : "copy"} className="flex"
        initial={{ opacity: 0, scale: 0.8, filter: "blur(2px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: dur.fast, ease: ease.out } }}
        exit={{ opacity: 0, scale: 0.8, filter: "blur(2px)", transition: { duration: dur.d120, ease: ease.out } }}>
        {on ? <Icon name="check" size={16} className="text-success" /> : <Icon name="copy" size={16} />}
      </motion.span>
    </AnimatePresence>
  );
}

export function ActionsA(props: LabProps) {
  const demo = useActionsDemo(props, 1800);
  return (
    <Message demo={demo}
      copyButton={<button type="button" onClick={demo.copy} aria-label={demo.copied ? "copied" : "copy message"} className={ACTION}><SwapIcon on={demo.copied} /></button>}
      picker={(
        <AnimatePresence>
          {demo.open && (
            <motion.div key="picker" role="toolbar" aria-label="reactions" className={PICKER} style={{ transformOrigin: "12px 0" }}
              initial={{ opacity: 0, scale: 0.97, y: -2 }} animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: dur.fast, ease: ease.out } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}>
              <PickerRow demo={demo} />
            </motion.div>
          )}
        </AnimatePresence>
      )}
      chip={(
        <AnimatePresence>
          {demo.mine && (
            <motion.button key={demo.mine} type="button" aria-label={`${NAMES[demo.mine]}, you`} onClick={() => demo.react(demo.mine!)} className={CHIP}
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: ease.out } }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: dur.exit } }}>
              <span className="text-[16px] leading-4">{demo.mine}</span>
            </motion.button>
          )}
        </AnimatePresence>
      )} />
  );
}

/* ---------------- B: alive ---------------- */

/** the copy glyph turns away as the check springs in, and "Copied" rolls out beside it (reimplemented from the
 * db-copy-button study on designbookmark.com/motion: no code taken) */
function CopyMorph({ on }: { on: boolean }) {
  return (
    <span className="flex items-center gap-1 px-1">
      <span className="relative flex size-4 items-center justify-center">
        <AnimatePresence initial={false}>
          {on ? (
            <motion.span key="check" className="absolute flex" initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1, transition: spring.pop }}
              exit={{ opacity: 0, scale: 0.6, transition: { duration: dur.exit } }}>
              <Icon name="check" size={16} className="text-success" />
            </motion.span>
          ) : (
            <motion.span key="copy" className="absolute flex" initial={{ opacity: 0, scale: 0.7, rotate: 0 }} animate={{ opacity: 1, scale: 1, rotate: 0, transition: spring.fade }}
              exit={{ opacity: 0, scale: 0.5, rotate: -40, transition: { duration: dur.d150, ease: ease.out } }}>
              <Icon name="copy" size={16} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <AnimatePresence initial={false}>
        {on && (
          <motion.span key="label" className="overflow-hidden whitespace-nowrap text-[12px] text-ink-secondary"
            initial={{ width: 0, opacity: 0 }} animate={{ width: "auto", opacity: 1, transition: { width: spring.width, opacity: { duration: dur.fast, delay: 0.06 } } }}
            exit={{ width: 0, opacity: 0, transition: { duration: dur.d150, ease: ease.out } }}>
            <motion.span className="inline-block" initial={{ y: 8, filter: "blur(2px)" }} animate={{ y: 0, filter: "blur(0px)", transition: spring.fade }}>Copied</motion.span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function ActionsB(props: LabProps) {
  const demo = useActionsDemo(props, 1800, 160);
  return (
    <Message demo={demo}
      copyButton={<button type="button" onClick={demo.copy} aria-label={demo.copied ? "copied" : "copy message"} className={ACTION}><CopyMorph on={demo.copied} /></button>}
      picker={(
        <AnimatePresence>
          {demo.open && (
            <motion.div key="picker" role="toolbar" aria-label="reactions" className={PICKER} style={{ transformOrigin: "12px 0" }}
              initial={{ opacity: 0, scale: 0.94, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0, transition: spring.fade }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}>
              <PickerRow demo={demo} lively />
            </motion.div>
          )}
        </AnimatePresence>
      )}
      chip={(
        <AnimatePresence>
          {demo.mine && (
            <motion.button key={demo.mine} type="button" aria-label={`${NAMES[demo.mine]}, you`} onClick={() => demo.react(demo.mine!)} className={CHIP}
              initial={{ opacity: 0, scale: 0.85, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0, transition: spring.pop }}
              exit={{ opacity: 0, scale: 0.92, transition: { duration: dur.exit } }}>
              <span className="text-[16px] leading-4">{demo.mine}</span>
            </motion.button>
          )}
        </AnimatePresence>
      )} />
  );
}
