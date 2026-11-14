import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/Icon";
import { SectionRows } from "@/components/SidebarSectionRows";
import { cn } from "@/lib/cn";
import { dur, ease, spring, stagger } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { BOTS, Mascot, columns, labBtn, useKeyboardIntent, useScript, useStretch, type LabBot, type Mode } from "./kit";

const ROW = 54;
const GAP = 2;

/** The chat beside the list: it swaps at once on every switch, in every column. */
function ChatPane({ bot }: { bot: LabBot }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2 pb-1">
        <Mascot color={bot.color} size={22} />
        <span className="truncate text-[13px] font-medium leading-[18px]">{bot.name}</span>
      </div>
      <div className="ms-auto max-w-[85%] rounded-[16px] bg-ink/[0.06] px-3 py-2 text-[13px] leading-[18px]">how is it going?</div>
      <div className="max-w-[90%] text-[13px] leading-[18px] text-ink">{bot.preview}.</div>
    </div>
  );
}

function RowBody({ bot, label = true }: { bot: LabBot; label?: boolean }) {
  return (
    <>
      <Mascot color={bot.color} />
      {label && (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-medium leading-5 tracking-[0.01em] text-ink">{bot.name}</span>
          <span className="truncate text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">{bot.preview}</span>
        </span>
      )}
    </>
  );
}

const rowCls = "relative z-[1] flex h-[54px] w-full cursor-pointer items-center gap-2.5 rounded-[12px] p-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

function stepKey(event: KeyboardEvent, at: number, count: number): number | null {
  if (event.key === "ArrowDown") return Math.min(count - 1, at + 1);
  if (event.key === "ArrowUp") return Math.max(0, at - 1);
  return null;
}

// 1. active row on switch

function Switch({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [sel, setSel] = useState("nova");
  const list = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardIntent(list);
  useScript(replayKey, speed, [[500, () => setSel("juno")], [1300, () => setSel("quill")], [2200, () => setSel("tally")]], () => setSel("nova"));
  const at = BOTS.findIndex((bot) => bot.id === sel);
  const top = at * (ROW + GAP);
  const instant = reduced || keyboard.current === true;
  const onKeyDown = (event: KeyboardEvent) => {
    const next = stepKey(event, at, BOTS.length);
    if (next === null) return;
    event.preventDefault();
    setSel(BOTS[next]!.id);
    list.current?.querySelectorAll<HTMLElement>("button")[next]?.focus();
  };
  return (
    <div className="flex h-full">
      <div ref={list} onKeyDown={onKeyDown} className="relative flex w-[200px] shrink-0 flex-col gap-0.5 bg-panel p-2">
        {mode === "a" && (
          <motion.div aria-hidden className="absolute inset-x-2 top-2 h-[54px] rounded-[12px] bg-ink/[0.08]" initial={false}
            animate={{ y: top }} transition={instant ? { duration: 0 } : spring.fade} />
        )}
        {mode === "b" && <Stretch top={top} instant={instant} />}
        {BOTS.map((bot) => {
          const chosen = bot.id === sel;
          return (
            <button key={bot.id} type="button" aria-current={chosen ? "page" : undefined} onClick={() => setSel(bot.id)}
              className={cn(rowCls, chosen ? mode === "original" && "bg-ink/[0.08]" : "hover:bg-ink/[0.06]")}>
              <RowBody bot={bot} />
            </button>
          );
        })}
      </div>
      <ChatPane bot={BOTS[at]!} />
    </div>
  );
}

function Stretch({ top, instant }: { top: number; instant: boolean }) {
  const { start, size } = useStretch(top, top + ROW, instant);
  return <motion.div aria-hidden className="absolute inset-x-2 top-2 rounded-[12px] bg-ink/[0.08]" style={{ y: start, height: size }} />;
}

// 2. reorder on activity

function Reorder({ mode, replayKey, speed }: LabProps & { mode: Mode }) {
  const [order, setOrder] = useState(BOTS.map((bot) => bot.id));
  const [unread, setUnread] = useState<string[]>([]);
  const [risen, setRisen] = useState<{ id: string; n: number } | null>(null);
  const bump = (id: string) => {
    setOrder((was) => [id, ...was.filter((other) => other !== id)]);
    setUnread((was) => (was.includes(id) ? was : [...was, id]));
    setRisen((was) => ({ id, n: (was?.n ?? 0) + 1 }));
  };
  useScript(replayKey, speed, [[500, () => bump("tally")], [1700, () => bump("rivet")]], () => { setOrder(BOTS.map((bot) => bot.id)); setUnread([]); setRisen(null); });
  const Row = mode === "original" ? "div" : motion.div;
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-hidden bg-panel p-2">
          {order.map((id) => {
            const bot = BOTS.find((each) => each.id === id)!;
            const motionProps = mode === "original" ? {} : { layout: "position" as const, transition: mode === "b" && risen?.id === id ? spring.soft : spring.layout };
            return (
              <Row key={id} {...motionProps} className={cn("relative rounded-[12px]", id === "nova" ? "bg-ink/[0.08]" : "hover:bg-ink/[0.06]", mode === "b" && risen?.id === id && "z-[2]")}>
                {mode === "b" && risen?.id === id && (
                  <motion.span key={risen.n} aria-hidden className="absolute inset-0 rounded-[12px] bg-ink/[0.06]" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: dur.d500, ease: ease.out, delay: 0.2 }} />
                )}
                <div className="flex h-[54px] items-center gap-2.5 p-2">
                  <RowBody bot={bot} />
                  {unread.includes(id) && <Dot mode={mode} />}
                </div>
              </Row>
            );
          })}
        </div>
        <ChatPane bot={BOTS[0]!} />
      </div>
      <div className="flex justify-center p-2">
        <button type="button" className={labBtn} onClick={() => bump(order.at(-1)!)}>{BOTS.find((bot) => bot.id === order.at(-1))!.name} gets a reply</button>
      </div>
    </div>
  );
}

function Dot({ mode }: { mode: Mode }) {
  const cls = "size-2 shrink-0 rounded-full bg-accent";
  if (mode === "original") return <span aria-label="unread" className={cls} />;
  if (mode === "a") return <motion.span aria-label="unread" className={cls} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: dur.fast, ease: ease.out }} />;
  return <motion.span aria-label="unread" className={cls} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring.pop, delay: 0.18, opacity: { duration: dur.fast, delay: 0.18 } }} />;
}

// 3. section fold

const TEAM = BOTS.slice(0, 3);
const MINE = BOTS.slice(3);

function SmallRow({ bot }: { bot: LabBot }) {
  return (
    <div className="flex h-10 items-center gap-2.5 rounded-[10px] px-2 hover:bg-ink/[0.06]">
      <Mascot color={bot.color} size={26} />
      <span className="truncate text-[14px] leading-5 text-ink">{bot.name}</span>
      <span className="ms-auto truncate text-[12px] leading-4 text-ink-secondary">{bot.title}</span>
    </div>
  );
}

function SectionHead({ open, onToggle, count, mode }: { open: boolean; onToggle: () => void; count: number; mode: Mode }) {
  return (
    <button type="button" aria-expanded={open} onClick={onToggle}
      className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-[8px] px-2 text-[12px] leading-4 text-ink-secondary hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
      <span>Team</span>
      {mode === "b" ? (
        <AnimatePresence initial={false} mode="popLayout">
          {!open && <motion.span key="count" className="tabular-nums" initial={{ opacity: 0, y: 6, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -4, transition: { duration: dur.exit } }} transition={{ duration: dur.swap, ease: ease.out }}>{count}</motion.span>}
        </AnimatePresence>
      ) : !open && <span className="tabular-nums">{count}</span>}
      {mode === "original" ? (
        <span className={cn("flex", open && "rotate-90")}><Icon name="chevron-right" size={12} /></span>
      ) : (
        <motion.span className="flex" initial={false} animate={{ rotate: open ? 90 : 0 }} transition={mode === "a" ? { duration: dur.swap, ease: ease.out } : spring.settle}><Icon name="chevron-right" size={12} /></motion.span>
      )}
    </button>
  );
}

function Fold({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [open, setOpen] = useState(true);
  useScript(replayKey, speed, [[500, () => setOpen(false)], [1700, () => setOpen(true)]], () => setOpen(true));
  const rows = TEAM.map((bot) => <SmallRow key={bot.id} bot={bot} />);
  let body: ReactNode;
  if (mode === "original") body = <SectionRows open={open} animate>{rows}</SectionRows>;
  else if (mode === "a") {
    body = (
      <div className="grid" style={{ gridTemplateRows: open ? "1fr" : "0fr", transition: reduced ? "none" : `grid-template-rows var(--lab-dur-250) var(--lab-ease-out)` }}>
        <div className="flex min-h-0 flex-col gap-1 overflow-hidden" inert={!open} style={{ opacity: open ? 1 : 0, transition: `opacity ${open ? 200 : 120}ms var(--lab-ease-out)` }}>{rows}</div>
      </div>
    );
  } else {
    body = (
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="rows" className="flex flex-col gap-1 overflow-hidden"
            initial={{ height: 0 }} animate={{ height: "auto", transition: spring.height }} exit={{ height: 0, transition: { duration: dur.swap, ease: ease.out } }}>
            {TEAM.map((bot, index) => (
              <motion.div key={bot.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0, transition: { ...spring.fade, delay: 0.04 + index * stagger.in } }}
                exit={{ opacity: 0, transition: { duration: dur.exit } }}>
                <SmallRow bot={bot} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }
  return (
    <div className="flex h-full">
      <div className="flex w-[220px] shrink-0 flex-col gap-1 bg-panel p-2">
        <SectionHead open={open} onToggle={() => setOpen((was) => !was)} count={TEAM.length} mode={mode} />
        {body}
        <div className="mt-2 flex h-7 items-center px-2 text-[12px] leading-4 text-ink-secondary">Personal</div>
        {MINE.map((bot) => <SmallRow key={bot.id} bot={bot} />)}
      </div>
      <ChatPane bot={BOTS[0]!} />
    </div>
  );
}

// 4. sidebar width (list to avatars)

const FULL = 200;
const RAIL = 64;

function Width({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [rail, setRail] = useState(false);
  useScript(replayKey, speed, [[500, () => setRail(true)], [1800, () => setRail(false)]], () => setRail(false));
  const width = rail ? RAIL : FULL;
  const toggle = (
    <button type="button" aria-label={rail ? "show names" : "avatars only"} aria-pressed={rail} onClick={() => setRail((was) => !was)}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-secondary hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-focus">
      {mode === "original"
        ? <span className={cn("flex", rail && "rotate-180")}><Icon name="chevron-left" size={14} /></span>
        : <motion.span className="flex" initial={false} animate={{ rotate: rail ? 180 : 0 }} transition={mode === "a" ? { duration: dur.swap, ease: ease.out } : spring.settle}><Icon name="chevron-left" size={14} /></motion.span>}
    </button>
  );
  const rows = BOTS.map((bot, index) => {
    const chosen = bot.id === "nova";
    if (mode === "original") {
      return (
        <div key={bot.id} className={cn("flex h-[54px] items-center rounded-[12px]", rail ? "justify-center" : "gap-2.5 p-2", chosen ? "bg-ink/[0.08]" : "hover:bg-ink/[0.06]")}>
          <RowBody bot={bot} label={!rail} />
        </div>
      );
    }
    const label = (
      <span className="flex min-w-0 flex-1 flex-col whitespace-nowrap">
        <span className="truncate text-[14px] font-medium leading-5 tracking-[0.01em] text-ink">{bot.name}</span>
        <span className="truncate text-[13px] leading-[18px] tracking-[0.015em] text-ink-secondary">{bot.preview}</span>
      </span>
    );
    return (
      <div key={bot.id} className={cn("flex h-[54px] items-center gap-2.5 overflow-hidden rounded-[12px] py-2 pl-1.5 pr-2", chosen ? "bg-ink/[0.08]" : "hover:bg-ink/[0.06]")}>
        <span className="shrink-0"><Mascot color={bot.color} /></span>
        {mode === "a" ? (
          <span className="flex min-w-0 flex-1" style={{ opacity: rail ? 0 : 1, transition: rail ? "opacity 100ms var(--lab-ease-out)" : "opacity 150ms var(--lab-ease-out) 120ms" }}>{label}</span>
        ) : (
          <motion.span className="flex min-w-0 flex-1" initial={false} animate={{ opacity: rail ? 0 : 1, x: rail ? -10 : 0 }}
            transition={rail ? { duration: dur.d75 } : { ...spring.fade, delay: 0.06 + index * 0.04 }}>{label}</motion.span>
        )}
      </div>
    );
  });
  const asideCls = "flex shrink-0 flex-col gap-0.5 overflow-hidden bg-panel p-2";
  return (
    <div className="flex h-full">
      {mode === "b" ? (
        <motion.div className={asideCls} initial={false} animate={{ width }} transition={reduced ? { duration: 0 } : spring.soft}>
          <div className="flex h-8 items-center pl-[10px]">{toggle}</div>
          {rows}
        </motion.div>
      ) : (
        <div className={asideCls} style={{ width, transition: reduced ? "none" : mode === "a" ? "width var(--lab-dur-250) var(--lab-ease-out)" : "width 200ms cubic-bezier(.22,1,.36,1)" }}>
          <div className={cn("flex h-8 items-center", mode === "original" ? (rail ? "justify-center" : "justify-end") : "pl-[10px]")}>{toggle}</div>
          {rows}
        </div>
      )}
      <ChatPane bot={BOTS[0]!} />
    </div>
  );
}

export const sidebarItems: Item[] = [
  {
    id: "sidebar-switch",
    title: "sidebar: switching bots",
    surface: "sidebar",
    height: 300,
    notes: {
      original: "the 8% ink fill jumps to the clicked row; the chat swaps at once. Click rows or use the arrow keys.",
      a: "one highlight glides on spring.fade 420/32; arrow keys jump it; the chat still swaps instantly",
      b: "two-edge stretch: the edge facing the move on spring.lead 620/36, the back edge on spring.trail 190/19; keys jump",
    },
    ...columns(Switch),
  },
  {
    id: "sidebar-reorder",
    title: "sidebar: a bot moves up on activity",
    surface: "sidebar",
    height: 340,
    loopMs: 3200,
    notes: {
      original: "the row jumps to the top and the rest jump down a slot; the unread dot is just there",
      a: "FLIP: every row slides to its new slot on spring.layout (0.3s, no bounce); dot fades in 150ms",
      b: "FLIP with the risen row on spring.soft 260/24 above the others, a 6% tint that fades 500ms, dot pops on spring.pop 520/26",
    },
    ...columns(Reorder),
  },
  {
    id: "sidebar-section",
    title: "sidebar: section fold",
    surface: "sidebar",
    height: 340,
    notes: {
      original: "real SectionRows: height + opacity 200ms ease-sharp; chevron and count flip at once",
      a: "grid-rows 0fr/1fr 250ms ease.out, rows fade 200ms in / 120ms out; chevron turns 200ms",
      b: "height on spring.height 300/22, rows drop in 6px staggered 45ms, all leave at once in 120ms; chevron on spring.settle; count swaps",
    },
    ...columns(Fold),
  },
  {
    id: "sidebar-width",
    title: "sidebar: names to avatars",
    surface: "sidebar",
    height: 340,
    loopMs: 3400,
    notes: {
      original: "width 200ms ease-out; names vanish at once and the mascots jump to centre",
      a: "width 250ms ease.out; mascots never move; names fade out 100ms, back in 150ms after 120ms",
      b: "width on spring.soft 260/24; names leave at once, come back sliding 10px on spring.fade, 60ms + 40ms per row",
    },
    ...columns(Width),
  },
];
