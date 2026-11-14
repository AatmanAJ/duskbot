import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AgentCursor } from "@/components/browser/AgentCursor";
import { Loader2, MousePointer2 } from "@/icons";
import { cn } from "@/lib/cn";
import { dur, ease, ms, offset, spring, stagger, timing } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { columns, labBtn, useBox, useScript, useStretch, useWidth, type Mode } from "./kit";

const frameTone = "bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_6%)]";
const screenCls = `relative w-full overflow-hidden rounded-xl ${frameTone}`;

type Site = { id: string; title: string; letter: string; tint: string };
const SITES: Site[] = [
  { id: "flights", title: "Flights to Lisbon", letter: "F", tint: "bg-[#2f6fe4]" },
  { id: "mail", title: "Inbox (3)", letter: "M", tint: "bg-[#d64b3c]" },
  { id: "docs", title: "Trip notes", letter: "D", tint: "bg-[#2a9d5c]" },
  { id: "hotel", title: "Hotels in Alfama", letter: "H", tint: "bg-[#c07a12]" },
  { id: "maps", title: "Lisbon map", letter: "L", tint: "bg-[#6b5bd2]" },
];

/** A stand-in for the stream frame of a page the bot has open. */
function SitePage({ site, typed = "" }: { site: Site; typed?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col gap-[6%] bg-composer p-[5%]">
      <div className="flex items-center gap-2">
        <span className={cn("size-3 rounded-[3px]", site.tint)} />
        <span className="h-2 w-1/4 rounded bg-ink/[0.14]" />
        <span className="ms-auto h-2 w-1/6 rounded bg-ink/[0.08]" />
      </div>
      <div className="flex h-[16%] items-center gap-[3%]">
        <span className="flex h-full flex-1 items-center rounded-md bg-ink/[0.05] px-2 text-[10px] text-ink/70">{typed}</span>
        <span className={cn("h-full w-[20%] rounded-md opacity-80", site.tint)} />
      </div>
      <div className="flex flex-1 flex-col gap-[7%]">
        {[0.7, 0.55, 0.62].map((w, i) => (
          <div key={i} className="flex items-center gap-2"><span className="size-4 rounded bg-ink/[0.07]" /><span className="h-2 rounded bg-ink/[0.09]" style={{ width: `${w * 100}%` }} /></div>
        ))}
      </div>
    </div>
  );
}

function Mark({ site }: { site: Site }) {
  return <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-medium leading-none text-white", site.tint)}>{site.letter}</span>;
}

function Flare({ side }: { side: "left" | "right" }) {
  return (
    <span aria-hidden className={cn("pointer-events-none absolute bottom-0 size-2.5",
      side === "left" ? "-left-2.5 bg-[radial-gradient(circle_at_0_0,transparent_9.5px,var(--color-composer)_10px)]"
        : "-right-2.5 bg-[radial-gradient(circle_at_100%_0,transparent_9.5px,var(--color-composer)_10px)]")} />
  );
}

const tabCls = "relative flex h-8 min-w-[76px] max-w-[200px] flex-1 basis-0 cursor-pointer items-center gap-1.5 rounded-t-[10px] px-2.5 text-left text-[12px] leading-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus";

// 1. the joined tab strip

function Strip({ mode, tabs, selected, onSelect, reduced, fresh }: { mode: Mode; tabs: Site[]; selected: string; onSelect: (id: string) => void; reduced: boolean; fresh: string | null }) {
  const chosen = useRef<HTMLButtonElement>(null);
  const box = useBox(chosen, [selected, tabs.length]);
  return (
    <div role="tablist" aria-label="Nova's tabs" className="relative flex h-[38px] shrink-0 items-end gap-0.5 overflow-hidden px-3 pt-1.5">
      {mode !== "original" && box.w > 0 && (mode === "a"
        ? <motion.span aria-hidden className="absolute bottom-0 left-0 h-8 rounded-t-[10px] bg-composer" initial={false} animate={{ x: box.x, width: box.w }} transition={reduced ? { duration: 0 } : spring.layout}><Flare side="left" /><Flare side="right" /></motion.span>
        : <StretchCut left={box.x} right={box.x + box.w} instant={reduced} />)}
      {tabs.map((site) => {
        const on = site.id === selected;
        const label = <><Mark site={site} /><span className="min-w-0 flex-1 truncate">{site.title}</span></>;
        if (mode === "original") {
          return (
            <button key={site.id} ref={on ? chosen : undefined} type="button" role="tab" aria-selected={on} onClick={() => onSelect(site.id)}
              className={cn(tabCls, "transition-[background-color,color,opacity] duration-150 ease-out starting:opacity-0", on ? "z-10 bg-composer text-ink" : "text-ink-secondary hover:bg-ink/[0.04] hover:text-ink")}>
              {on && <><Flare side="left" /><Flare side="right" /></>}
              {label}
            </button>
          );
        }
        const grow = mode === "b" && site.id === fresh;
        return (
          <motion.button key={site.id} ref={on ? chosen : undefined} type="button" role="tab" aria-selected={on} onClick={() => onSelect(site.id)}
            layout={mode === "a" ? "position" : undefined}
            initial={grow ? { minWidth: 0, maxWidth: 0, opacity: 0 } : mode === "a" && site.id === fresh ? { opacity: 0 } : false}
            animate={{ minWidth: 76, maxWidth: 200, opacity: 1 }}
            transition={grow ? { minWidth: spring.width, maxWidth: spring.width, opacity: { duration: dur.swap, delay: timing.contentLag / 1000 } } : { ...spring.layout, opacity: { duration: dur.fast } }}
            className={cn(tabCls, "z-10 overflow-hidden transition-colors duration-150", on ? "text-ink" : "text-ink-secondary hover:text-ink")}>
            {label}
          </motion.button>
        );
      })}
    </div>
  );
}

function StretchCut({ left, right, instant }: { left: number; right: number; instant: boolean }) {
  const { start, size } = useStretch(left, right, instant);
  return <motion.span aria-hidden className="absolute bottom-0 left-0 h-8 rounded-t-[10px] bg-composer" style={{ x: start, width: size }}><Flare side="left" /><Flare side="right" /></motion.span>;
}

function BrowserTabs({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [count, setCount] = useState(3);
  const [selected, setSelected] = useState("flights");
  const [fresh, setFresh] = useState<string | null>(null);
  const tabs = SITES.slice(0, count);
  const open = () => setCount((was) => {
    const next = was >= SITES.length ? 3 : was + 1;
    const added = SITES[next - 1]!.id;
    setFresh(next > was ? added : null);
    setSelected(next > was ? added : "flights");
    return next;
  });
  useScript(replayKey, speed, [[500, () => setSelected("mail")], [1300, open], [2300, () => setSelected("flights")]], () => { setCount(3); setSelected("flights"); setFresh(null); });
  const site = SITES.find((each) => each.id === selected) ?? SITES[0]!;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className={cn(screenCls, "flex flex-col")}>
        <Strip mode={mode} tabs={tabs} selected={selected} onSelect={setSelected} reduced={reduced} fresh={fresh} />
        <div className="relative aspect-[16/10] w-full overflow-hidden"><SitePage site={site} /></div>
      </div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink/[0.56]">Using the browser</span>
        <button type="button" className={labBtn} onClick={open}>{count >= SITES.length ? "reset tabs" : "bot opens a tab"}</button>
      </div>
    </div>
  );
}

// 2. connecting, live, closed

type Phase = "connecting" | "live" | "closed";
const STATUS: Record<Phase, string> = { connecting: "", live: "Using the browser", closed: "" };

function ClosedCard() {
  return (
    <div className="flex flex-col gap-2">
      <div className={cn("flex flex-col items-center gap-1 rounded-xl px-5 py-5 text-center", frameTone)}>
        <p className="m-0 text-[13px] font-medium leading-[18px] text-ink">The browser is closed</p>
        <p className="m-0 text-pretty text-[12px] leading-4 text-ink-secondary">Nova opens it again when a task needs it.</p>
      </div>
      <h3 className="m-0 mt-1 px-1 text-[12px] font-normal leading-4 text-ink/[0.56]">Worked on</h3>
      {SITES.slice(0, 2).map((site) => (
        <div key={site.id} className="flex items-center gap-2.5 px-1 py-1">
          <span className="relative h-8 w-12 shrink-0 overflow-hidden rounded-md bg-ink/[0.06]"><span className="absolute inset-0 flex items-center justify-center"><Mark site={site} /></span></span>
          <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px]">{site.title}</span>
          <span className="text-[12px] leading-4 text-ink/[0.56]">2m</span>
        </div>
      ))}
    </div>
  );
}

function Connecting({ reduced }: { reduced: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-[12px] leading-4 text-ink/[0.56]">
      <Loader2 size={14} aria-hidden="true" className={reduced ? undefined : "animate-spin"} />Connecting
    </div>
  );
}

function Skeleton({ reduced }: { reduced: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col gap-[6%] bg-composer p-[5%]" role="status" aria-label="Connecting">
      <motion.div className="flex h-full flex-col gap-[6%]" animate={reduced ? { opacity: 0.6 } : { opacity: [0.45, 0.85, 0.45] }} transition={reduced ? { duration: 0 } : { duration: 1.4, ease: "easeInOut", repeat: 3 }}>
        <span className="h-2 w-1/4 rounded bg-ink/10" />
        <span className="h-[16%] w-full rounded-md bg-ink/[0.06]" />
        <span className="h-2 w-2/3 rounded bg-ink/[0.07]" />
        <span className="h-2 w-1/2 rounded bg-ink/[0.07]" />
      </motion.div>
    </div>
  );
}

function BrowserState({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const timer = useRef(0);
  const connect = () => {
    setPhase("connecting");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPhase("live"), ms(mode === "original" ? 350 : Math.max(350, timing.minWait), speed));
  };
  useScript(replayKey, speed, [[0, connect], [2500, () => setPhase("closed")]], () => window.clearTimeout(timer.current));
  const live = phase === "live";
  const strip = live && <TabsRow mode={mode} />;
  let view: ReactNode;
  if (mode === "original") {
    view = phase === "closed" ? <ClosedCard /> : (
      <div className={cn(screenCls, "flex flex-col")}>
        {strip}
        <div className={cn("relative aspect-[16/10] w-full overflow-hidden bg-composer", !live && "rounded-t-xl")}>
          {live ? <SitePage site={SITES[0]!} /> : <Connecting reduced={reduced} />}
        </div>
      </div>
    );
  } else {
    const a = mode === "a";
    view = (
      <AnimatePresence initial={false} mode="popLayout">
        {phase === "closed" ? (
          <motion.div key="closed" initial={{ opacity: 0, y: a ? 0 : offset.swapIn }} animate={{ opacity: 1, y: 0 }} transition={a ? { duration: dur.swap, ease: ease.out } : { ...spring.fade, delay: 0.08 }}>
            <ClosedCard />
          </motion.div>
        ) : (
          <motion.div key="screen" className={cn(screenCls, "flex flex-col")} exit={a ? { opacity: 0, transition: { duration: dur.fast } } : { opacity: 0, scale: 0.97, transition: { duration: dur.fast, ease: ease.out } }}>
            <motion.div initial={false} animate={{ height: live ? 38 : 0 }} transition={a ? { duration: dur.expand, ease: ease.out } : spring.height} className="overflow-hidden">{strip}</motion.div>
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-composer">
              <AnimatePresence initial={false}>
                {live ? (
                  <motion.div key="page" className="absolute inset-0"
                    initial={a ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)", scale: 1.01 }} animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
                    transition={a ? { duration: dur.swap, ease: ease.out } : { duration: dur.d420, ease: ease.outExpo }}>
                    <SitePage site={SITES[0]!} />
                  </motion.div>
                ) : (
                  <motion.div key="wait" className="absolute inset-0" exit={{ opacity: 0, transition: { duration: dur.fast } }}>
                    {a ? <Connecting reduced={reduced} /> : <Skeleton reduced={reduced} />}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {view}
      <div className="flex min-h-7 items-center gap-1.5">
        <span className="relative flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[12px] leading-4 text-ink/[0.56]">
          {mode === "b" && live && <motion.span aria-hidden className="size-1.5 rounded-full bg-success" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring.pop, delay: 0.12 }} />}
          {mode === "original" ? STATUS[phase] : (
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={phase} className="truncate" initial={{ opacity: 0, y: offset.swapIn, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: offset.swapOut, transition: { duration: dur.exit } }} transition={{ duration: dur.swap, ease: ease.out }}>{STATUS[phase]}</motion.span>
            </AnimatePresence>
          )}
        </span>
        <button type="button" className={labBtn} onClick={connect}>reconnect</button>
        <button type="button" className={labBtn} disabled={phase === "closed"} onClick={() => setPhase("closed")}>close</button>
      </div>
    </div>
  );
}

function TabsRow({ mode }: { mode: Mode }) {
  return (
    <div className="flex h-[38px] items-end gap-0.5 px-3 pt-1.5">
      {SITES.slice(0, 2).map((site, index) => {
        const tab = (
          <span className={cn(tabCls, "cursor-default", index === 0 ? "bg-composer text-ink" : "text-ink-secondary")}>
            {index === 0 && <><Flare side="left" /><Flare side="right" /></>}<Mark site={site} /><span className="min-w-0 flex-1 truncate">{site.title}</span>
          </span>
        );
        if (mode !== "b") return <span key={site.id} className="contents">{tab}</span>;
        return (
          <motion.span key={site.id} className="flex min-w-[76px] max-w-[200px] flex-1 basis-0 [&>span]:max-w-none [&>span]:flex-1" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.fade, delay: 0.1 + index * stagger.in }}>{tab}</motion.span>
        );
      })}
    </div>
  );
}

// 3. the bot's cursor

type Target = { x: number; y: number; label: string; typed?: string };
const TARGETS: Target[] = [
  { x: 0.3, y: 0.3, label: "typing", typed: "Lisbon, 14 Nov" },
  { x: 0.84, y: 0.3, label: "clicking Search" },
  { x: 0.42, y: 0.62, label: "opening a result" },
];

type Pointer = { x: number; y: number; phase: "move" | "click"; seq: number; label: string };

function BrowserCursor({ mode, replayKey, speed, reduced }: LabProps & { mode: Mode }) {
  const page = useRef<HTMLDivElement>(null);
  const width = useWidth(page);
  const height = width * 10 / 16;
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [typed, setTyped] = useState("");
  const seq = useRef(0);
  const go = (target: { x: number; y: number; label: string; typed?: string }, phase: "move" | "click") => {
    seq.current += 1;
    setPointer({ x: target.x, y: target.y, phase, seq: seq.current, label: target.label });
    if (phase === "click" && target.typed) setTyped(target.typed);
  };
  const steps: Array<[number, () => void]> = TARGETS.flatMap((target, index) => [
    [300 + index * 900, () => go(target, "move")] as [number, () => void],
    [650 + index * 900, () => go(target, "click")] as [number, () => void],
  ]);
  useScript(replayKey, speed, steps, () => { setPointer(null); setTyped(""); });
  const clickAt = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const target = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height, label: "clicking" };
    go(target, "move");
    window.setTimeout(() => go(target, "click"), ms(350, speed));
  };
  const left = (pointer?.x ?? 0.5) * width;
  const top = (pointer?.y ?? 0.5) * height;
  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className={cn(screenCls, "p-0")}>
        <div ref={page} role="button" tabIndex={0} aria-label="point Nova somewhere on the page" onClick={clickAt}
          onKeyDown={(event) => { if (event.key === "Enter") go(TARGETS[seq.current % TARGETS.length]!, "click"); }}
          className="relative aspect-[16/10] w-full cursor-crosshair overflow-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
          <SitePage site={SITES[0]!} typed={typed} />
          {pointer && width > 0 && (mode === "original"
            ? <AgentCursor phase={pointer.phase} sequence={pointer.seq} left={left} top={top} controller="agent" />
            : <Cursor mode={mode} pointer={pointer} left={left} top={top} reduced={reduced} />)}
        </div>
      </div>
      <span className="text-[12px] leading-4 text-ink/[0.56]">Click the page to point Nova there</span>
    </div>
  );
}

function Cursor({ mode, pointer, left, top, reduced }: { mode: Mode; pointer: Pointer; left: number; top: number; reduced: boolean }) {
  const b = mode === "b";
  const glide = reduced ? { duration: 0 } : b ? { x: spring.soft, y: spring.settle } : spring.fade;
  return (
    <motion.div aria-hidden className="pointer-events-none absolute left-0 top-0 z-30" initial={false} animate={{ x: left, y: top }} transition={glide}>
      <motion.div key={pointer.seq} initial={{ opacity: 1 }} animate={{ opacity: 0.35 }} transition={{ duration: dur.swap, delay: 0.7 }}>
        {pointer.phase === "click" && !reduced && (
          <motion.span key={`ring${pointer.seq}`} className="absolute -left-2 -top-2 size-5 rounded-full border-2 border-accent/50"
            initial={{ scale: 0.5, opacity: 1 }} animate={{ scale: b ? 1.8 : 1.4, opacity: 0 }} transition={{ duration: 0.4, ease: ease.out }} />
        )}
        <motion.span className="relative block origin-top-left" initial={pointer.phase === "click" ? { scale: 0.86 } : false} animate={{ scale: 1 }} transition={spring.pop}>
          <MousePointer2 className="relative size-5 -translate-x-0.5 -translate-y-0.5 fill-card text-accent drop-shadow-sm" strokeWidth={2} />
        </motion.span>
        {b && (
          <span className={cn("absolute top-4 flex h-5 items-center overflow-hidden whitespace-nowrap rounded-full bg-accent px-2 text-[11px] leading-none text-white", pointer.x > 0.55 ? "right-1" : "left-4")}>
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={pointer.label} initial={{ opacity: 0, y: offset.swapIn, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: offset.swapOut, transition: { duration: dur.exit } }} transition={{ duration: dur.swap, ease: ease.out }}>
                Nova · {pointer.label}
              </motion.span>
            </AnimatePresence>
          </span>
        )}
      </motion.div>
    </motion.div>
  );
}

export const browserItems: Item[] = [
  {
    id: "browser-tabs",
    title: "Computer tab: the joined tab strip",
    surface: "bot panel / Computer",
    height: 360,
    loopMs: 3400,
    notes: {
      original: "LocalBrowser TabStrip: the joined tab (with its flares) jumps, colours ease 150ms; a new tab fades in via starting:opacity-0 while the rest snap narrower; the page frame swaps at once",
      a: "the cut-out tab glides on spring.layout and its neighbours slide (layout); a new tab fades 150ms; frames still swap with no animation",
      b: "the cut-out stretches (lead 620/36, trail 190/19) with the flares riding its edges; a new tab grows from 0 on spring.width 380/24, its label 80ms later",
    },
    ...columns(BrowserTabs),
  },
  {
    id: "browser-state",
    title: "Computer tab: connecting, live, closed",
    surface: "bot panel / Computer",
    height: 360,
    loopMs: 3800,
    notes: {
      original: "every state swaps at once: a spinner for as long as it takes (350ms here, so it flashes), then the frame and tabs, then the closed card",
      a: "spinner held at least 800ms, then 200ms crossfades; the tab row opens 250ms; status words rise 8px",
      b: "the page silhouette breathes (3 pulses max), the first frame sharpens from 4px blur over 420ms outExpo, tabs drop in 45ms apart, a live dot pops; closing shrinks the screen to .97 and lifts the card in",
    },
    ...columns(BrowserState),
  },
  {
    id: "browser-cursor",
    title: "Computer tab: the bot's cursor",
    surface: "bot panel / Computer",
    height: 340,
    notes: {
      original: "real AgentCursor (MIT, from t3code): a 150ms ease-out transform jump, an endless animate-ping while it clicks, dims to 35% after 700ms",
      a: "glides on spring.fade 420/32; a click is one ring (0.5 to 1.4, 400ms) and a press on spring.pop; same dimming",
      b: "x on spring.soft, y on spring.settle so long moves arc a little; a name tag says what it is doing (words swap rising 8px); bigger ring",
    },
    ...columns(BrowserCursor),
  },
];
