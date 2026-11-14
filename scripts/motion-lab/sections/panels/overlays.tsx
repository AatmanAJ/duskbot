/// <reference path="../../../../src/types/duskDesktop.d.ts" />
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/Icon";
import { confirmCancelCls, formBodyCls, formCloseCls, formFooterCls, formHeaderCls, formSheetCls, formTitleCls, mdDangerCls, rowHintCls, smallButtonCls } from "@/components/ui/GrokDialog";
import { ScrimMotion, SheetMotion } from "@/components/ui/SheetMotion";
import { Loader2 } from "@/icons";
import { cn } from "@/lib/cn";
import { dialogMotion } from "@/lib/motion-presets";
import { dur, ease, ms, offset, spring, timing } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { BOTS, Mascot, columns, labBtn, useScript, type Mode } from "./kit";

const BOT = BOTS[0]!;

// 1. confirm dialog

type Step = "idle" | "busy" | "done";

function DeleteButton({ mode, step, onClick }: { mode: Mode; step: Step; onClick: () => void }) {
  if (mode !== "b") return <button type="button" className={mdDangerCls} onClick={onClick}>Delete</button>;
  const width = step === "idle" ? 68 : step === "busy" ? 32 : 92;
  return (
    <motion.button type="button" aria-busy={step === "busy"} disabled={step !== "idle"} onClick={onClick} initial={false} animate={{ width }} transition={spring.width}
      className={cn(mdDangerCls, "relative overflow-hidden px-0 transition-colors duration-200", step === "done" && "bg-ink! text-app! disabled:opacity-100")}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={step} className="flex items-center gap-1" initial={{ opacity: 0, y: offset.swapIn, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: offset.swapOut, transition: { duration: dur.exit } }} transition={{ duration: dur.swap, ease: ease.out }}>
          {step === "idle" && "Delete"}
          {step === "busy" && <Loader2 size={14} aria-label="deleting" className="animate-spin" />}
          {step === "done" && (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: dur.draw, ease: ease.inOut, delay: 0.15 }} />
              </svg>
              Deleted
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function ConfirmDialog({ mode, reduced, step, onClose, onConfirm, focus }: { mode: Mode; reduced: boolean; step: Step; onClose: () => void; onConfirm: () => void; focus: boolean }) {
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) sheet.current?.focus({ preventScroll: true }); }, [focus]);
  const original = mode === "original" ? dialogMotion(reduced) : null;
  const scrimMotion = original?.scrim ?? {
    initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.16, ease: ease.out } }, exit: { opacity: 0, transition: { duration: dur.exit, ease: ease.out } },
  };
  const sheetMotion = original?.sheet ?? (mode === "a"
    ? { initial: { opacity: 0, scale: 0.96 }, animate: { opacity: 1, scale: 1, transition: { duration: dur.swap, ease: ease.out } }, exit: { opacity: 0, scale: 0.98, transition: { duration: dur.exit, ease: ease.out } } }
    : { initial: { opacity: 0, scale: 0.96, y: offset.swapIn }, animate: { opacity: 1, scale: 1, y: 0, transition: { ...spring.fade, opacity: { duration: dur.fast, ease: ease.out } } }, exit: { opacity: 0, scale: 0.98, transition: { duration: dur.exit, ease: ease.out } } });
  // the fix: an animated dialog opts out of overlays.css's keyframe, so only motion moves it
  const raw = mode === "original" ? {} : { "data-raw-dialog": "" };
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center p-4" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <ScrimMotion aria-hidden="true" {...raw} className="ui-dialog-scrim absolute inset-0" onMouseDown={onClose} {...scrimMotion} />
      <SheetMotion ref={sheet} {...raw} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ maxWidth: "min(360px, calc(100% - 32px))" }} className={formSheetCls} {...sheetMotion}>
        <header className={cn(formHeaderCls, "items-center pb-1")}>
          <h2 id={titleId} className={formTitleCls}>Delete {BOT.name}?</h2>
          <button type="button" aria-label="close" onClick={onClose} className={formCloseCls}><Icon name="close" size={16} /></button>
        </header>
        <div className={cn(formBodyCls, "pt-0")}><p className={cn(rowHintCls, "m-0 text-pretty")}>{BOT.name}'s chats, memory and skills are removed. You can't undo this.</p></div>
        <div className={formFooterCls}>
          <button type="button" className={confirmCancelCls} onClick={onClose}>Cancel</button>
          <DeleteButton mode={mode} step={step} onClick={onConfirm} />
        </div>
      </SheetMotion>
    </div>
  );
}

function Dialog({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [byHand, setByHand] = useState(false);
  const timers = useRef<number[]>([]);
  const later = (at: number, run: () => void) => { timers.current.push(window.setTimeout(run, ms(at, speed))); };
  const clear = () => { timers.current.forEach((timer) => window.clearTimeout(timer)); timers.current = []; };
  const close = () => { clear(); setOpen(false); };
  const confirm = () => {
    if (mode !== "b") return close();
    setStep("busy");
    later(timing.minWait, () => setStep("done"));
    later(timing.minWait + 700, () => setOpen(false));
  };
  const show = (hand: boolean) => { setStep("idle"); setByHand(hand); setOpen(true); };
  useScript(replayKey, speed, mode === "b"
    ? [[300, () => show(false)], [1200, confirm]]
    : [[300, () => show(false)], [2000, () => setOpen(false)]], () => { clear(); setOpen(false); });
  useEffect(() => clear, []);
  return (
    <div className="relative flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-3 rounded-[14px] bg-ink/[0.04] p-3">
        <Mascot color={BOT.color} size={32} />
        <div className="flex min-w-0 flex-1 flex-col"><span className="text-[13px] font-medium leading-[18px]">{BOT.name}</span><span className="text-[12px] leading-4 text-ink-secondary">{BOT.title}</span></div>
        <button type="button" className={cn(labBtn, "text-danger")} onClick={() => show(true)}>Delete bot</button>
      </div>
      <div className="flex flex-col gap-2 px-1">{[0.8, 0.6, 0.7].map((w, i) => <span key={i} className="h-2 rounded bg-ink/[0.06]" style={{ width: `${w * 100}%` }} />)}</div>
      <AnimatePresence>{open && <ConfirmDialog key="dialog" mode={mode} reduced={reduced} step={step} focus={byHand} onClose={close} onConfirm={confirm} />}</AnimatePresence>
    </div>
  );
}

// 2. toasts

type Note = { id: number; tone: "done" | "error"; text: string; undo?: boolean };
const NOTES: Array<Omit<Note, "id">> = [
  { tone: "done", text: `Archived ${BOT.name}`, undo: true },
  { tone: "error", text: "Couldn't reach Gmail: the sign-in expired" },
  { tone: "done", text: "Saved to Nova's memory" },
];

function ToastBody({ note, onClose }: { note: Note; onClose: () => void }) {
  const error = note.tone === "error";
  return (
    <>
      <span aria-hidden="true" className={cn("inline-flex shrink-0", error ? "text-danger" : "text-ink-secondary")}><Icon name={error ? "exclamation-circle" : "check"} size={13} /></span>
      <span className="min-w-0 flex-1 truncate">{note.text}</span>
      {note.undo && <button type="button" className={smallButtonCls} onClick={onClose}>Undo</button>}
      <button type="button" aria-label="dismiss" onClick={onClose} className="ui-toast-close"><Icon name="close" size={12} /></button>
    </>
  );
}

// .ui-toast is fixed and centred by translateX(-50%); the stage contains fixed children, these keep it inside the stage
const place = { left: 16, right: 16, insetInlineStart: 16, width: "auto", transform: "none", bottom: 76 } as const;

function Toasts({ mode, replayKey, speed }: LabProps & { mode: Mode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const count = useRef(0);
  const push = (index: number) => {
    count.current += 1;
    const note = { ...NOTES[index % NOTES.length]!, id: count.current };
    setNotes((was) => (mode === "b" ? [...was, note].slice(-3) : [note]));
  };
  const drop = (id?: number) => setNotes((was) => (id === undefined ? was.slice(0, -1) : was.filter((note) => note.id !== id)));
  useScript(replayKey, speed, mode === "b"
    ? [[300, () => push(0)], [900, () => push(1)], [1500, () => push(2)], [2700, () => drop()]]
    : [[300, () => push(0)], [1400, () => push(1)], [2700, () => drop()]], () => { setNotes([]); count.current = 0; });
  const front = notes.at(-1);
  let layer: ReactNode = null;
  if (mode === "original") {
    layer = front && <div role={front.tone === "error" ? "alert" : "status"} className="ui-toast" style={place}><ToastBody note={front} onClose={() => drop(front.id)} /></div>;
  } else if (mode === "a") {
    layer = (
      <AnimatePresence>
        {front && (
          <motion.div key="toast" role={front.tone === "error" ? "alert" : "status"} className="ui-toast overflow-hidden" style={place}
            initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: dur.swap, ease: ease.out } }}
            transition={{ duration: dur.settle, ease: ease.out }}>
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={front.id} className="flex min-w-0 flex-1 items-center gap-[10px]" initial={{ opacity: 0, y: offset.swapIn, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: offset.swapOut, transition: { duration: dur.exit } }} transition={{ duration: dur.swap, ease: ease.out }}>
                <ToastBody note={front} onClose={() => drop(front.id)} />
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    );
  } else {
    layer = <Stack notes={notes} onDrop={drop} />;
  }
  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-wrap justify-center gap-2 p-3">
        <button type="button" className={labBtn} onClick={() => push(0)}>archive</button>
        <button type="button" className={labBtn} onClick={() => push(1)}>a failure</button>
        <button type="button" className={labBtn} onClick={() => push(2)}>saved</button>
      </div>
      <div className="mx-4 mt-auto mb-4 flex h-12 items-center rounded-[24px] bg-composer px-4 text-[14px] text-ink/40 outline-1 -outline-offset-1 outline-ink/10 [outline-style:solid]">Ask Nova anything</div>
      {layer}
    </div>
  );
}

const PEEK = 10;
const ROW_H = 40;

function Stack({ notes, onDrop }: { notes: Note[]; onDrop: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute inset-x-4 bottom-[76px] z-[70] h-10" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)} onFocus={() => setOpen(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <AnimatePresence initial={false}>
        {notes.map((note, index) => {
          const depth = notes.length - 1 - index;
          const front = depth === 0;
          return (
            <motion.div key={note.id} role={note.tone === "error" ? "alert" : "status"} className="ui-toast"
              style={{ position: "absolute", inset: "auto 0 0 0", width: "auto", transform: "none", zIndex: 10 - depth, transformOrigin: "50% 0%" }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: depth > 2 ? 0 : 1, y: open ? -depth * (ROW_H + 8) : -depth * PEEK, scale: open ? 1 : 1 - 0.05 * depth }}
              exit={{ opacity: 0, y: 8, transition: { duration: dur.fast, ease: ease.out } }}
              transition={spring.fade}
              drag={front ? "y" : false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.1, bottom: 1 }} dragTransition={{ bounceStiffness: spring.settle.stiffness, bounceDamping: spring.settle.damping }}
              onDragEnd={(_, info) => { if (info.offset.y > 45 || info.velocity.y > 110) onDrop(note.id); }}>
              <span className="flex min-w-0 flex-1 items-center gap-[10px]" style={{ opacity: open || front ? 1 : 0, transition: "opacity 150ms var(--lab-ease-out)" }}>
                <ToastBody note={note} onClose={() => onDrop(note.id)} />
              </span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export const overlayItems: Item[] = [
  {
    id: "dialog",
    title: "dialogs: open and close (the double animation)",
    surface: "sheets and dialogs",
    height: 300,
    loopMs: 3600,
    notes: {
      original: "real GrokDialog parts with animated on: overlays.css runs its 6px/.985 240ms keyframe on [aria-modal] while motion runs scale .97 on the modal spring 340/30; the keyframe owns transform for 240ms, then motion's value snaps in, and the scrim fades twice. Watch at 0.25x",
      a: "fixed: data-raw-dialog opts the sheet and scrim out of the keyframe; motion alone, scale .96 to 1 + fade over 200ms ease.out; out in 120ms at .98",
      b: "same fix; rises 8px on spring.fade 420/32; Delete turns into a spinner circle (spring.width, 800ms floor), then a Deleted pill whose check draws, then it closes",
    },
    ...columns(Dialog),
  },
  {
    id: "toast",
    title: "toasts",
    surface: "notices",
    height: 300,
    notes: {
      original: "real .ui-toast look: there at once, gone at once; a new one replaces the old in the same frame",
      a: "one toast surface: in from 16px at .97 over 320ms ease.out, out 200ms; a new message swaps the words in place (rise 8px, 2px blur)",
      b: "a Sonner-style stack (rebuilt, no dependency): 3 deep, 10px peek at -5% scale each; hover fans them out; swipe the front one down (45px or 0.11px/ms) to dismiss",
    },
    ...columns(Toasts),
  },
];
