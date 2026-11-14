import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/Icon";
import { MotionDiv } from "@/components/ui/SheetMotion";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { cn } from "@/lib/cn";
import { SWAP, WIPE } from "@/lib/motion-presets";
import { dur, ease, offset, spring } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { BOTS, Mascot, columns, useBox, useKeyboardIntent, useScript, useStretch, type Mode } from "./kit";

const BOT = BOTS[0]!;
const roundBtn = "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink/[0.66] hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-focus";
const listCard = "flex flex-col rounded-[14px] bg-ink/[0.04] py-1";

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className={listCard}>
      {rows.map(([title, hint]) => (
        <div key={title} className="flex h-9 items-center gap-3 px-3 text-[13px] leading-[18px]">
          <span className="text-ink">{title}</span>
          <span className="ms-auto truncate text-ink/[0.68]">{hint}</span>
        </div>
      ))}
    </div>
  );
}

function Hero({ small = false }: { small?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", small ? "pb-2" : "flex-col pb-3 pt-1")}>
      <Mascot color={BOT.color} size={small ? 36 : 56} />
      <div className={cn("flex flex-col", !small && "items-center")}>
        <span className="text-[15px] font-medium leading-5">{BOT.name}</span>
        <span className="text-[12px] leading-4 text-ink-secondary">{BOT.title} · working</span>
      </div>
    </div>
  );
}

// 1. panel open and close

const PW = 240;

function PanelContent({ onClose }: { onClose: () => void }) {
  return (
    <div className="relative flex h-full w-[240px] flex-col bg-app px-3">
      <span aria-hidden className="absolute inset-y-0 left-0 w-[0.5px] bg-edge" />
      <div className="flex h-11 items-center justify-end"><button type="button" aria-label="close the panel" onClick={onClose} className={roundBtn}><Icon name="close" size={15} /></button></div>
      <Hero />
      <div className="flex justify-center gap-0.5 pb-2.5">
        {["Details", "Computer", "Advanced"].map((label, index) => (
          <span key={label} className={cn("h-[26px] rounded-full px-2 py-1 text-[13px] leading-[18px]", index === 0 ? "bg-ink/[0.06] text-ink" : "text-ink-secondary")}>{label}</span>
        ))}
      </div>
      <Rows rows={[["Model", "Sonnet"], ["Memory", "12 notes"], ["Schedule", "Daily"]]} />
    </div>
  );
}

function Chat({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2.5 p-3">
      <div className="flex items-center gap-2">
        <Mascot color={BOT.color} size={22} />
        <span className="truncate text-[13px] font-medium">{BOT.name}</span>
        <button type="button" aria-label={open ? "close the bot panel" : "open the bot panel"} aria-pressed={open} onClick={onToggle} className={cn(roundBtn, "ms-auto")}><Icon name="info" size={15} /></button>
      </div>
      <div className="ms-auto max-w-[85%] rounded-[16px] bg-ink/[0.06] px-3 py-2 text-[13px] leading-[18px]">find me a flight to Lisbon on the 14th</div>
      <div className="text-[13px] leading-[18px]">On it. I'll compare the direct ones first and check bag fees, then book the best morning one.</div>
    </div>
  );
}

function PanelOpen({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [open, setOpen] = useState(false);
  useScript(replayKey, speed, [[400, () => setOpen(true)], [2000, () => setOpen(false)]], () => setOpen(false));
  const toggle = () => setOpen((was) => !was);
  const content = <PanelContent onClose={() => setOpen(false)} />;
  let slot: ReactNode;
  if (mode === "b") {
    slot = (
      <motion.div className="relative h-full shrink-0 overflow-hidden" inert={!open} initial={false} animate={{ width: open ? PW : 0 }}
        transition={reduced ? { duration: 0 } : open ? spring.soft : { duration: dur.swap, ease: ease.out }}>
        <motion.div className="absolute inset-y-0 left-0" initial={false} animate={{ opacity: open ? 1 : 0, x: open ? 0 : 24 }}
          transition={open ? { ...spring.fade, delay: 0.08 } : { opacity: { duration: 0.1 }, x: { duration: 0 } }}>{content}</motion.div>
      </motion.div>
    );
  } else {
    const width = mode === "a"
      ? `width ${open ? 250 : 200}ms var(--lab-ease-out)`
      : "width 260ms cubic-bezier(0.2,0,0,1)";
    slot = (
      <div className="relative h-full shrink-0 overflow-hidden" inert={!open} style={{ width: open ? PW : 0, transition: reduced ? "none" : width }}>
        <div className="absolute inset-y-0 left-0"
          style={mode === "a" ? { opacity: open ? 1 : 0, transition: open ? "opacity 200ms var(--lab-ease-out) 60ms" : "opacity 120ms var(--lab-ease-out)" } : undefined}>{content}</div>
      </div>
    );
  }
  return <div className="flex h-full"><Chat open={open} onToggle={toggle} />{slot}</div>;
}

// 2. panel tabs

type Tab = "details" | "computer" | "advanced";
const TABS: Array<{ value: Tab; label: string }> = [{ value: "details", label: "Details" }, { value: "computer", label: "Computer" }, { value: "advanced", label: "Advanced" }];

function TabBody({ tab }: { tab: Tab }) {
  if (tab === "details") return <Rows rows={[["Name", BOT.name], ["Role", BOT.title], ["Model", "Sonnet"], ["Instructions", "Prefer morning flights"]]} />;
  if (tab === "computer") {
    return (
      <div className="flex flex-col gap-2">
        <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)] p-2">
          <div className="h-full rounded-lg bg-composer p-2"><div className="h-2 w-1/2 rounded bg-ink/10" /><div className="mt-2 h-2 w-3/4 rounded bg-ink/[0.06]" /><div className="mt-1.5 h-2 w-2/3 rounded bg-ink/[0.06]" /></div>
        </div>
        <span className="text-[12px] leading-4 text-ink/[0.56]">Using the browser</span>
      </div>
    );
  }
  return <Rows rows={[["Backup AIs", "2"], ["Start fresh", ""], ["Archive", ""]]} />;
}

function PanelTabs({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [tab, setTab] = useState<Tab>("details");
  const shown = useRef<Tab>("details");
  const swapped = useRef(false);
  const dir = useRef(1);
  const pick = (next: Tab) => {
    const index = (value: Tab) => TABS.findIndex((each) => each.value === value);
    dir.current = index(next) >= index(shown.current) ? 1 : -1;
    shown.current = next;
    swapped.current = true;
    setTab(next);
  };
  useScript(replayKey, speed, [[500, () => pick("computer")], [1400, () => pick("advanced")], [2300, () => pick("details")]], () => { swapped.current = false; shown.current = "details"; setTab("details"); });
  let body: ReactNode;
  if (mode === "original") {
    body = <MotionDiv key={tab} role="tabpanel" initial={reduced || !swapped.current ? false : SWAP.initial} animate={SWAP.animate}><TabBody tab={tab} /></MotionDiv>;
  } else if (mode === "a") {
    body = <motion.div key={tab} role="tabpanel" initial={swapped.current ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ duration: dur.fast, ease: ease.out }}><TabBody tab={tab} /></motion.div>;
  } else {
    body = (
      <AnimatePresence initial={false} mode="popLayout" custom={dir.current}>
        <motion.div key={tab} role="tabpanel" custom={dir.current}
          variants={{ enter: (d: number) => ({ opacity: 0, x: d * 16 }), center: { opacity: 1, x: 0 }, exit: (d: number) => ({ opacity: 0, x: d * -8, transition: { duration: dur.exit, ease: ease.out } }) }}
          initial="enter" animate="center" exit="exit" transition={{ duration: dur.swap, ease: ease.out }}>
          <TabBody tab={tab} />
        </motion.div>
      </AnimatePresence>
    );
  }
  return (
    <div className="mx-auto flex h-full w-[320px] max-w-full flex-col overflow-hidden bg-app px-4 pt-3">
      <Hero small />
      <div className="flex justify-center pb-2.5 pt-1">
        {mode === "original"
          ? <SegmentedTabs label="bot panel" value={tab} onChange={pick} tabs={TABS} />
          : <PillTabs value={tab} onChange={pick} stretch={mode === "b"} reduced={reduced} />}
      </div>
      <div className="relative pt-1">{body}</div>
    </div>
  );
}

function PillTabs({ value, onChange, stretch, reduced }: { value: Tab; onChange: (tab: Tab) => void; stretch: boolean; reduced: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  const keyboard = useKeyboardIntent(list);
  const at = TABS.findIndex((tab) => tab.value === value);
  const chosen = useRef<HTMLButtonElement>(null);
  const box = useBox(chosen, [value]);
  const instant = reduced || keyboard.current === true;
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (at + step + TABS.length) % TABS.length;
    onChange(TABS[next]!.value);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };
  return (
    <div ref={list} role="tablist" aria-label="bot panel" onKeyDown={onKeyDown} className="relative flex gap-0.5">
      {box.w > 0 && (stretch
        ? <StretchPill left={box.x} right={box.x + box.w} instant={instant} />
        : <motion.span aria-hidden className="absolute inset-y-0 left-0 rounded-full bg-ink/[0.06]" initial={false} animate={{ x: box.x, width: box.w }} transition={instant ? { duration: 0 } : spring.layout} />)}
      {TABS.map((tab) => {
        const selected = tab.value === value;
        return (
          <button key={tab.value} ref={selected ? chosen : undefined} type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} onClick={() => onChange(tab.value)}
            className={cn("relative h-[26px] rounded-full px-2 py-1 text-[13px] leading-[18px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus", selected ? "text-ink" : "text-ink-secondary hover:text-ink")}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function StretchPill({ left, right, instant }: { left: number; right: number; instant: boolean }) {
  const { start, size } = useStretch(left, right, instant);
  return <motion.span aria-hidden className="absolute inset-y-0 left-0 rounded-full bg-ink/[0.06]" style={{ x: start, width: size }} />;
}

// 3. page push and pop

type Page = "memory" | "note";
const TITLES: Record<Page, string> = { memory: "Memory", note: "Lisbon trip" };

function PageBody({ page, onOpen }: { page: Page | null; onOpen: (page: Page) => void }) {
  const row = (label: string, hint: string, to?: Page) => (
    <button key={label} type="button" onClick={to ? () => onOpen(to) : undefined}
      className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-[10px] px-3 text-left text-[13px] leading-[18px] hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
      <span className="text-ink">{label}</span><span className="ms-auto text-ink/[0.68]">{hint}</span>{to && <Icon name="chevron-right" size={12} />}
    </button>
  );
  if (page === null) return <><Hero small />{row("Memory", "12 notes", "memory")}{row("Skills", "4")}{row("Schedule", "Daily")}{row("Webhooks", "1")}</>;
  if (page === "memory") return <><p className="m-0 px-3 pb-2 text-[13px] leading-[18px] text-ink-secondary">What Nova keeps between chats.</p>{row("Lisbon trip", "today", "note")}{row("Seat preference", "window")}{row("Home airport", "LHR")}</>;
  return <p className="m-0 px-3 text-[13px] leading-[20px] text-ink">Fly on the 14th, morning if possible. Direct only, one checked bag. Hotel near Alfama.</p>;
}

function PanelPages({ mode, replayKey, speed }: LabProps & { mode: Mode }) {
  const [stack, setStack] = useState<Page[]>([]);
  const nav = useRef({ depth: 0, dir: 1 });
  if (nav.current.depth !== stack.length) nav.current = { depth: stack.length, dir: stack.length > nav.current.depth ? 1 : -1 };
  const dir = nav.current.dir;
  const page = stack.at(-1) ?? null;
  const open = (next: Page) => setStack((was) => [...was, next]);
  const back = () => setStack((was) => was.slice(0, -1));
  useScript(replayKey, speed, [[500, () => open("memory")], [1300, () => open("note")], [2200, back], [2900, back]], () => setStack([]));
  const transition = mode === "original" ? { duration: WIPE.duration, ease: WIPE.ease }
    : mode === "a" ? { duration: dur.expand, ease: ease.out }
    : dir > 0 ? spring.push : { ...spring.push, visualDuration: 0.34 };
  const variants = {
    enter: (d: number) => ({ x: d > 0 ? "100%" : mode === "a" ? "-25%" : "-30%", opacity: 1, zIndex: d > 0 ? 1 : 0 }),
    center: { x: "0%", opacity: 1 },
    exit: (d: number) => (d > 0 ? { x: mode === "a" ? "-25%" : "-30%", opacity: 0, zIndex: 0 } : { x: "100%", opacity: 1, zIndex: 1 }),
  };
  const title = page ? TITLES[page] : "";
  return (
    <div className="mx-auto flex h-full w-[320px] max-w-full flex-col overflow-hidden bg-app">
      <div className="relative flex h-11 shrink-0 items-center px-3">
        <AnimatePresence initial={false}>
          {page && (mode === "original"
            ? <button type="button" aria-label="back" onClick={back} className={roundBtn}><Icon name="chevron-left" size={14} /></button>
            : <motion.button key="back" type="button" aria-label="back" onClick={back} className={roundBtn}
                initial={{ opacity: 0, x: mode === "b" ? 8 : 0 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, transition: { duration: dur.exit } }} transition={{ duration: dur.swap, ease: ease.out }}>
                <Icon name="chevron-left" size={14} />
              </motion.button>)}
        </AnimatePresence>
        <span className="pointer-events-none absolute inset-x-12 top-1/2 flex h-[18px] -translate-y-1/2 justify-center overflow-hidden text-[13px] font-medium leading-[18px]">
          {mode === "original" ? title : (
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={title} className="block truncate"
                initial={mode === "b" ? { opacity: 0, y: offset.swapIn, filter: "blur(2px)" } : { opacity: 0 }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={mode === "b" ? { opacity: 0, y: offset.swapOut, filter: "blur(2px)", transition: { duration: dur.exit } } : { opacity: 0, transition: { duration: dur.exit } }}
                transition={{ duration: dur.swap, ease: ease.out }}>{title}</motion.span>
            </AnimatePresence>
          )}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} custom={dir}>
          <motion.div key={`${stack.length}:${page}`} custom={dir} variants={variants} initial="enter" animate="center" exit="exit" transition={transition}
            className="absolute inset-0 flex flex-col gap-0.5 bg-app px-3 pt-1">
            <PageBody page={page} onOpen={open} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export const panelItems: Item[] = [
  {
    id: "panel-open",
    title: "bot panel: open and close",
    surface: "bot panel",
    height: 320,
    loopMs: 3400,
    notes: {
      original: "PanelSlot: the column grows 0 to 320 (240 here) over 260ms cubic-bezier(.2,0,0,1), content pinned to its left edge so it slides in; same curve closing",
      a: "width 250ms ease.out open, 200ms close; content fades in 200ms after 60ms, out 120ms",
      b: "width on spring.soft 260/24; content follows 80ms later, 24px slide on spring.fade; closes in a 200ms tween, content gone in 100ms",
    },
    ...columns(PanelOpen),
  },
  {
    id: "panel-tabs",
    title: "bot panel: Details / Computer / Advanced",
    surface: "bot panel",
    height: 340,
    notes: {
      original: "real SegmentedTabs (fill jumps) + the SWAP preset: new content rises 6px over 220ms, the old one is gone at once",
      a: "the fill glides on spring.layout (0.3s, no bounce); content fades in 150ms with no travel; arrow keys jump",
      b: "two-edge stretch fill (620/36 lead, 190/19 trail); content slides 16px from the side it came from, 200ms ease.out, old leaves 8px in 120ms",
    },
    ...columns(PanelTabs),
  },
  {
    id: "panel-page",
    title: "bot panel: page push and pop",
    surface: "bot panel",
    height: 320,
    loopMs: 3600,
    notes: {
      original: "WIPE: push slides in from 100% while the old page goes -30% and fades, 200ms ease-out; pop mirrors it; the title and back button swap at once",
      a: "same geometry at 250ms ease.out with a -25% parallax; title crossfades 150ms; back button fades",
      b: "spring.push (bounce 0, 0.42s) and 0.34s on pop; title rises 8px with 2px blur, old one leaves up; back slides in 8px",
    },
    ...columns(PanelPages),
  },
];
