import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, type TargetAndTransition, type Transition } from "motion/react";
import { Plus } from "@/icons";
import { IslandShowcase } from "@/ambient/IslandShowcase";
import { EASE_OUT, FADE, LIVELY, SETTLE, SOFT_EXIT } from "@/ambient/shared";
import { dur, ease, ms, offset, spring, stagger, timing } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { BOTS, Mascot, columns, useScript, useWidth, type LabBot, type Mode } from "./kit";

const INK = "#f5f5f5";
const TEAM = BOTS.slice(0, 4);
const STATE: Record<string, string> = { nova: "working", quill: "replied", juno: "asks you", rivet: "idle" };

/** The desktop the ambient surfaces sit on: a quiet wallpaper and a menu bar. */
function Desktop({ children, bar = 0 }: { children: ReactNode; bar?: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[color-mix(in_srgb,var(--color-app),var(--color-ink)_7%)]">
      {bar > 0 && <div className="absolute inset-x-0 top-0 bg-ink/[0.06]" style={{ height: bar }} />}
      {children}
    </div>
  );
}

// 1. notch island

const STAGE_W = 560;
const NOTCH = { width: 276, height: 37, notch: 192 };
const PANEL_W = 432;
const OPEN_H = NOTCH.height + 96;
type Wake = { bot: LabBot; emoji: string } | null;
const WAKES: Wake[] = [{ bot: BOTS[1]!, emoji: "🎉" }, { bot: BOTS[2]!, emoji: "🙋" }];

function IslandOriginal({ replayKey, speed }: LabProps) {
  const stage = useRef<HTMLDivElement>(null);
  const width = useWidth(stage);
  const [open, setOpen] = useState(false);
  useScript(replayKey, speed, [[2300, () => setOpen(true)], [3400, () => setOpen(false)]], () => setOpen(false));
  return (
    <div ref={stage} className="absolute inset-0">
      <Desktop bar={Math.round(37 * (width / STAGE_W))}>
        {width > 0 && <IslandShowcase key={replayKey} width={width} height={300} open={open} />}
      </Desktop>
    </div>
  );
}

function IslandReplica({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const stage = useRef<HTMLDivElement>(null);
  const width = useWidth(stage);
  const scale = width / STAGE_W || 1;
  const [wake, setWake] = useState<Wake>(null);
  const [nudged, setNudged] = useState(false);
  const [forced, setForced] = useState(false);
  const [hovered, setHovered] = useState(false);
  const leave = useRef(0);
  const open = forced || hovered;
  const b = mode === "b";
  const wakeUp = (next: Wake) => {
    setWake(next);
    if (!b || reduced) return;
    setNudged(true);
    window.setTimeout(() => setNudged(false), ms(1600, speed));
  };
  useScript(replayKey, speed, [[300, () => wakeUp(WAKES[0]!)], [1300, () => wakeUp(WAKES[1]!)], [2300, () => setForced(true)], [3400, () => setForced(false)]],
    () => { setWake(null); setForced(false); setNudged(false); });
  const w = open ? PANEL_W : wake ? NOTCH.width + (nudged ? 22 : 0) : NOTCH.notch;
  const h = open ? OPEN_H : NOTCH.height;
  const r = open ? (b ? 32 : 24) : 14;
  const sizeTransition: Transition = reduced ? { duration: 0 }
    : mode === "a" ? (open ? spring.fade : { duration: dur.expand, ease: ease.out })
    : { width: spring.width, height: open ? spring.height : { type: "spring", stiffness: 390, damping: 25 }, borderBottomLeftRadius: spring.height, borderBottomRightRadius: spring.height };
  const tile = 20;
  const swapIn = b ? { opacity: 0, y: offset.swapIn, filter: "blur(3px)" } : { opacity: 0 };
  const swapOut = b ? { opacity: 0, y: offset.swapOut, filter: "blur(3px)", transition: { duration: dur.exit } } : { opacity: 0, transition: { duration: dur.exit } };
  return (
    <div ref={stage} className="absolute inset-0">
      <Desktop bar={Math.round(37 * scale)}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: STAGE_W, height: 300 / scale, transform: `scale(${scale})` }}>
          <motion.section aria-label="bots" className="absolute top-0 overflow-hidden" style={{ left: "50%", x: "-50%", background: "#000", color: INK }}
            initial={false} animate={{ width: w, height: h, borderBottomLeftRadius: r, borderBottomRightRadius: r }} transition={sizeTransition}
            onPointerEnter={() => { window.clearTimeout(leave.current); setHovered(true); }}
            onPointerLeave={() => { leave.current = window.setTimeout(() => setHovered(false), ms(260, speed)); }}>
            <div className="absolute inset-x-3 top-0 flex items-center justify-between" style={{ height: NOTCH.height }}>
              <span className="relative grid place-items-center" style={{ width: tile, height: tile }}>
                <AnimatePresence initial={false} mode="popLayout">
                  {wake && !open && <motion.span key={wake.bot.id} initial={swapIn} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={swapOut} transition={b ? { ...spring.fade, opacity: { duration: dur.fast } } : { duration: dur.fast }}><Mascot color={wake.bot.color} size={tile} /></motion.span>}
                </AnimatePresence>
              </span>
              <span className="relative grid place-items-center text-[17px] leading-none" style={{ width: tile, height: tile }} aria-live="polite">
                <AnimatePresence initial={false} mode="popLayout">
                  {wake && !open && <motion.span key={wake.emoji} initial={swapIn} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={swapOut} transition={b ? { ...spring.fade, opacity: { duration: dur.fast } } : { duration: dur.fast }}>{wake.emoji}</motion.span>}
                </AnimatePresence>
              </span>
            </div>
            <AnimatePresence>
              {open && (
                <motion.ul key="panel" className="absolute inset-x-0 m-0 flex list-none justify-center gap-1.5 p-0" style={{ top: NOTCH.height + 8, width: PANEL_W }}
                  initial={b ? { opacity: 0, filter: "blur(4px)" } : { opacity: 0 }} animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={b ? { opacity: 0, filter: "blur(6px)", transition: { duration: 0.14 } } : { opacity: 0, transition: { duration: 0.1 } }}
                  transition={{ duration: b ? 0.35 : dur.fast, delay: b ? 0.09 : 0.08, ease: ease.out }}>
                  {TEAM.map((bot, index) => (
                    <motion.li key={bot.id} className="flex w-[64px] flex-col items-center gap-1 pt-1"
                      initial={b ? { y: offset.swapIn } : false} animate={{ y: 0 }} transition={{ duration: 0.6, ease: ease.outExpo, delay: 0.09 + index * stagger.in }}>
                      <Mascot color={bot.color} size={36} />
                      <span className="text-[11px] leading-[13px]">{bot.name}</span>
                      <span className="text-[10px] leading-3 opacity-50">{STATE[bot.id]}</span>
                    </motion.li>
                  ))}
                  <li className="grid w-[48px] place-items-start justify-center pt-1"><span className="grid size-9 place-items-center rounded-full opacity-50"><Plus size={18} strokeWidth={1.5} aria-hidden /></span></li>
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.section>
        </div>
      </Desktop>
      <span className="absolute bottom-3 left-0 right-0 text-center text-[12px] text-ink/[0.56]">Hover the notch to open it</span>
    </div>
  );
}

// 2. right-edge dock

const CELL = 56;
const COL = 64;
const SLIVER = 6;
const CARD_W = 248;
const GAPX = 10;
const TICK: Record<string, string | null> = { nova: "busy", quill: "reply", juno: "ask", rivet: null };

const CARD_LINES: Record<string, string[]> = {
  nova: ["On it. I'll compare the direct ones first and check bag fees."],
  quill: ["Here's a first draft: \"Faster turns, a calmer dock, and answers right where you are.\"", "Want me to run the build to check the screenshots?"],
  juno: ["Found two that work: 18:10 and 20:45. Which one?"],
  rivet: ["The footer is fixed and deployed."],
};

function CardPage({ bot }: { bot: LabBot }) {
  return (
    <div className="flex flex-col gap-2 p-3" style={{ width: CARD_W }}>
      <div className="flex items-center gap-2">
        <Mascot color={bot.color} size={20} />
        <span className="text-[13px] font-medium">{bot.name}</span>
        <span className="ms-auto text-[11px] opacity-60">{STATE[bot.id]}</span>
      </div>
      {CARD_LINES[bot.id]!.map((line) => <p key={line} className="m-0 text-[12.5px] leading-[17px] opacity-85">{line}</p>)}
      {bot.id === "juno" && (
        <div className="flex gap-1.5"><span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px]">18:10</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px]">20:45</span></div>
      )}
    </div>
  );
}

function Dock({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [out, setOut] = useState(false);
  const [card, setCard] = useState<string | null>(null);
  const [last, setLast] = useState<string>(TEAM[0]!.id);
  const timers = useRef<{ hide: number; card: number; dwell: number }>({ hide: 0, card: 0, dwell: 0 });
  const shown = useRef(false);
  const dir = useRef(1);
  const showCard = (id: string | null) => {
    if (id) {
      dir.current = TEAM.findIndex((bot) => bot.id === id) >= TEAM.findIndex((bot) => bot.id === last) ? 1 : -1;
      setLast(id);
    }
    setCard(id);
  };
  useScript(replayKey, speed, [[300, () => setOut(true)], [1000, () => showCard("nova")], [1800, () => showCard("juno")], [2700, () => showCard(null)], [3200, () => setOut(false)]],
    () => { setOut(false); setCard(null); });
  const clearAll = () => { window.clearTimeout(timers.current.hide); window.clearTimeout(timers.current.card); };
  const onBot = (id: string) => {
    clearAll();
    window.clearTimeout(timers.current.dwell);
    if (card) return showCard(id);
    timers.current.dwell = window.setTimeout(() => showCard(id), ms(450, speed));
  };
  const leaveAll = () => {
    window.clearTimeout(timers.current.dwell);
    timers.current.card = window.setTimeout(() => setCard(null), ms(90, speed));
    timers.current.hide = window.setTimeout(() => setOut(false), ms(520, speed));
  };
  useEffect(() => () => { clearAll(); window.clearTimeout(timers.current.dwell); }, []);

  const colH = TEAM.length * CELL + 16 + CELL;
  const slideTransition: Transition = reduced ? { duration: 0 }
    : mode === "original" ? (out ? SETTLE : { ...SOFT_EXIT, ease: [...SOFT_EXIT.ease] })
    : mode === "a" ? (out ? spring.fade : { duration: dur.expand, ease: ease.out })
    : (out ? spring.soft : { duration: dur.expand, ease: ease.out });

  const at = TEAM.findIndex((bot) => bot.id === (card ?? last));
  const cardBot = TEAM[at]!;
  const page = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(80);
  useLayoutEffect(() => {
    const node = page.current;
    if (!node) return;
    const read = () => setCardH(node.offsetHeight);
    read();
    const watch = new ResizeObserver(read);
    watch.observe(node);
    return () => watch.disconnect();
  }, [mode]);
  const glide = shown.current && !reduced;
  useEffect(() => { shown.current = card !== null; });
  // moving between bots in the original: the words settle from slightly faint, as Dock.tsx's WAAPI swap does
  const wasPage = useRef(cardBot.id);
  useLayoutEffect(() => {
    if (wasPage.current === cardBot.id) return;
    wasPage.current = cardBot.id;
    if (mode === "b" || !glide) return;
    page.current?.animate(mode === "original" && !reduced ? [{ opacity: 0.5, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0.5 }, { opacity: 1 }],
      { duration: 120, easing: `cubic-bezier(${EASE_OUT.join(",")})` });
  }, [cardBot.id, mode, glide, reduced]);

  return (
    <Desktop>
      <div className="absolute inset-0" onPointerLeave={leaveAll}>
        <div aria-hidden className="absolute inset-y-0 right-0 w-[14px]" onPointerEnter={() => { clearAll(); window.setTimeout(() => setOut(true), ms(120, speed)); }} />
        <DockColumn mode={mode} out={out} colH={colH} slide={slideTransition} onBot={onBot} reduced={reduced} onEnter={clearAll} />
        <DockCard mode={mode} card={card} bot={cardBot} at={at} colH={colH} cardH={cardH} glide={glide} reduced={reduced} dir={dir.current} page={page} onEnter={clearAll} />
      </div>
      <span className="pointer-events-none absolute bottom-3 left-3 text-[12px] text-ink/[0.56]">Rest on the right edge, then on a bot</span>
    </Desktop>
  );
}

function DockColumn({ mode, out, colH, slide, onBot, reduced, onEnter }: { mode: Mode; out: boolean; colH: number; slide: Transition; onBot: (id: string) => void; reduced: boolean; onEnter: () => void }) {
  return (
    <motion.div role="region" aria-label="bot dock" className="absolute right-0 top-1/2 flex flex-col py-2" onPointerEnter={onEnter}
      style={{ width: COL, height: colH, marginTop: -colH / 2, background: "#0c0c0c", color: INK, borderRadius: "22px 0 0 22px" }}
      initial={false} animate={{ x: out ? 0 : COL - SLIVER }} transition={slide}>
      <ul className="m-0 flex list-none flex-col p-0">
        {TEAM.map((bot, index) => (
          <li key={bot.id} className="relative grid place-items-center" style={{ height: CELL }}>
            {TICK[bot.id] && (
              <span aria-hidden className="absolute left-[1px] top-1/2 w-[3px] -translate-y-1/2 rounded-[2px]"
                style={{ height: TICK[bot.id] === "ask" ? 16 : TICK[bot.id] === "reply" ? 4 : 8, background: TICK[bot.id] === "reply" ? "#00ba69" : "#4d9bff", opacity: out ? 0 : 1, transition: "opacity 160ms var(--lab-ease-out)" }} />
            )}
            <motion.button type="button" aria-label={`${bot.name}, ${STATE[bot.id]}`} className="relative grid size-11 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-white/60"
              onPointerEnter={() => onBot(bot.id)} onFocus={() => onBot(bot.id)}
              initial={false} animate={mode === "b" ? { x: out || reduced ? 0 : 12, opacity: out ? 1 : 0.6 } : { x: 0 }}
              transition={mode === "b" && out ? { ...spring.fade, delay: 0.06 + index * stagger.in } : { duration: 0.1 }}>
              <Mascot color={bot.color} size={36} />
              {bot.id === "juno" && <span aria-hidden className="absolute -left-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full bg-[#116dd2] text-[8px] font-semibold">1</span>}
            </motion.button>
          </li>
        ))}
      </ul>
      <div className="grid place-items-center" style={{ height: CELL }}><span className="grid size-10 place-items-center opacity-50"><Plus size={18} strokeWidth={1.5} aria-hidden /></span></div>
    </motion.div>
  );
}

function DockCard({ mode, card, bot, at, colH, cardH, glide, reduced, dir, page, onEnter }: {
  mode: Mode; card: string | null; bot: LabBot; at: number; colH: number; cardH: number; glide: boolean; reduced: boolean; dir: number; page: React.RefObject<HTMLDivElement | null>; onEnter: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [stageH, setStageH] = useState(320);
  useLayoutEffect(() => { if (stage.current?.parentElement) setStageH(stage.current.parentElement.clientHeight); }, []);
  const anchor = stageH / 2 - colH / 2 + 8 + at * CELL + CELL / 2;
  const y = Math.round(Math.min(stageH - cardH - 8, Math.max(8, anchor - cardH / 2)));
  const shown = card !== null;
  const jump = { duration: 0 };
  let animateTo: TargetAndTransition;
  let transition: Transition;
  if (mode === "original") {
    animateTo = shown ? { opacity: 1, scale: 1, x: 0, y, height: cardH } : { opacity: 0, scale: reduced ? 1 : 0.97, x: reduced ? 0 : 6 };
    const g = glide ? SETTLE : jump;
    const out = { duration: 0.14, ease: [...EASE_OUT] as [number, number, number, number] };
    transition = shown ? { opacity: FADE, scale: glide ? SETTLE : LIVELY, x: SETTLE, y: g, height: g } : { opacity: out, scale: out, x: out, y: jump, height: jump };
  } else if (mode === "a") {
    animateTo = shown ? { opacity: 1, x: 0, y, height: cardH } : { opacity: 0, x: reduced ? 0 : 6 };
    const g = glide ? spring.fade : jump;
    transition = shown ? { opacity: { duration: dur.fast, ease: ease.out }, x: spring.fade, y: g, height: g } : { opacity: { duration: dur.exit }, x: { duration: dur.exit }, y: jump, height: jump };
  } else {
    animateTo = shown ? { opacity: 1, width: CARD_W, y, height: cardH, scale: 1 } : { opacity: 0, scale: reduced ? 1 : 0.97, transitionEnd: { width: 44, height: 44 } };
    const g = glide ? spring.settle : jump;
    transition = shown
      ? { opacity: { duration: dur.d120 }, width: glide ? jump : { type: "spring", stiffness: 340, damping: 21 }, height: glide ? spring.height : { type: "spring", stiffness: 230, damping: 21 }, y: g, scale: jump }
      : { opacity: { duration: 0.14 }, scale: { duration: 0.14 }, width: jump, height: jump, y: jump };
  }
  return (
    <motion.div ref={stage} role="dialog" aria-label={bot.name} inert={!shown} className="absolute top-0 overflow-hidden" onPointerEnter={onEnter}
      style={{ right: COL + GAPX, width: mode === "b" ? undefined : CARD_W, background: "#141414", color: INK, borderRadius: 18, transformOrigin: "100% 50%", pointerEvents: shown ? "auto" : "none" }}
      initial={mode === "b" ? { opacity: 0, width: 44, height: 44, y } : { opacity: 0, y, height: cardH }}
      animate={animateTo} transition={transition}>
      {mode === "b" ? (
        <div className="relative" style={{ width: CARD_W }}>
          <div ref={page} className="invisible absolute left-0 top-0" aria-hidden><CardPage bot={bot} /></div>
          <AnimatePresence initial={false} mode="popLayout" custom={dir}>
            <motion.div key={bot.id} custom={dir}
              variants={{ enter: (d: number) => ({ opacity: 0, y: d * offset.swapIn, filter: "blur(4px)" }), center: { opacity: 1, y: 0, filter: "blur(0px)" }, exit: (d: number) => ({ opacity: 0, y: d * offset.swapOut, filter: "blur(2px)", transition: { duration: dur.exit } }) }}
              initial="enter" animate="center" exit="exit" transition={{ duration: dur.swap, ease: ease.out, delay: glide ? 0 : timing.contentLag / 1000 + 0.01 }}>
              <CardPage bot={bot} />
            </motion.div>
          </AnimatePresence>
        </div>
      ) : (
        <div ref={page}><CardPage bot={bot} /></div>
      )}
    </motion.div>
  );
}

export const ambientItems: Item[] = [
  {
    id: "island",
    title: "notch island",
    surface: "ambient (desktop)",
    height: 300,
    loopMs: 4400,
    notes: {
      original: "the real Island (IslandShowcase on its own feed, autoplaying; follows the OS reduced-motion, not the lab toggle): opens on SETTLE 380/34, folds back on ISLAND_EXIT 420ms soft ease; wakes nudge it 22px wider",
      a: "replica at the same geometry: one spring.fade 420/32 for width and height, closes in 250ms ease.out; contents fade in 80ms after the shell; compact marks crossfade 150ms",
      b: "width on 380/24 lands before height on 300/22 (height 1.3x stiffer closing), corners grow to 32; contents sharpen from 4px blur and rise on outExpo, 45ms apart; marks swap rising 8px; wake nudge kept",
    },
    Original: IslandOriginal,
    A: (props: LabProps) => <IslandReplica {...props} mode="a" />,
    B: (props: LabProps) => <IslandReplica {...props} mode="b" />,
  },
  {
    id: "dock",
    title: "right-edge dock",
    surface: "ambient (desktop)",
    height: 340,
    loopMs: 4000,
    notes: {
      original: "replica of Dock.tsx values: column slides in on SETTLE 380/34, away on SOFT_EXIT 340ms after 520ms; card fades 160ms, scales from .97 on LIVELY 500/18 (overshoots), glides between bots on SETTLE; words settle from 50% + 3px in 120ms",
      a: "column in on spring.fade, out 250ms; card slides 6px and fades, no scale overshoot; glides on spring.fade; words just un-dim",
      b: "column on spring.soft with mascots sliding in 45ms apart; the card grows out of the bot, width on 340/21 then height on 230/21, words 80ms later; between bots the words roll the way you moved",
    },
    ...columns(Dock),
  },
];
