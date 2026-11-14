import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { dur, ease, ms, spring, timing } from "@lab/tokens";
import type { LabProps } from "@lab/types";
import { useScript, useStretch } from "./kit";

const TOOLS: Array<{ key: string; icon: IconName; label: string }> = [
  { key: "attach", icon: "paperclip", label: "Attach files" },
  { key: "voice", icon: "mic", label: "Dictate (⌥ Space)" },
  { key: "search", icon: "search", label: "Search this chat" },
  { key: "pin", icon: "pin", label: "Pin" },
  { key: "more", icon: "dots-3-horizontal", label: "More" },
];

/** a tooltip's timing: the first waits `delay`, a move while one shows (or within `warm` after) swaps at once */
function useTip(hover: string | null, speed: number, { delay, warm, hide }: { delay: number; warm: number; hide: number }) {
  const [tip, setTip] = useState<{ key: string; instant: boolean } | null>(null);
  const warmUntil = useRef(0);
  const shown = useRef<string | null>(null);
  shown.current = tip?.key ?? null;
  useLayoutEffect(() => {
    let timer = 0;
    if (hover) {
      const warmNow = shown.current !== null || performance.now() < warmUntil.current;
      if (warmNow) setTip({ key: hover, instant: true });
      else timer = window.setTimeout(() => setTip({ key: hover, instant: false }), ms(delay, speed));
    } else if (shown.current) {
      timer = window.setTimeout(() => {
        warmUntil.current = performance.now() + ms(warm, speed);
        setTip(null);
      }, ms(hide, speed));
    }
    return () => window.clearTimeout(timer);
  }, [hover, speed, delay, warm, hide]);
  return tip;
}

function useHoverDemo({ replayKey, speed }: LabProps) {
  const [hover, setHover] = useState<string | null>(null);
  const stop = useScript(replayKey, speed, [
    [400, () => setHover("attach")], [1100, () => setHover("voice")], [500, () => setHover("search")], [500, () => setHover("pin")],
    [700, () => setHover(null)], [900, () => setHover("more")], [1100, () => setHover(null)],
  ], () => setHover(null));
  return { hover, set: (key: string | null) => { stop(); setHover(key); } };
}

/** the toolbar, and where each button's centre sits */
function Toolbar({ demo, bar }: { demo: ReturnType<typeof useHoverDemo>; bar: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={bar} className="relative flex items-center gap-1 rounded-full bg-composer p-1 inset-ring-[0.5px] inset-ring-ink/[0.12]">
      {TOOLS.map((tool) => (
        <button key={tool.key} type="button" aria-label={tool.label} data-tool={tool.key}
          onPointerEnter={() => demo.set(tool.key)} onPointerLeave={() => demo.set(null)}
          onFocus={() => demo.set(tool.key)} onBlur={() => demo.set(null)}
          className={cn("flex size-8 items-center justify-center rounded-full text-ink-secondary transition-colors duration-[120ms] hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-focus",
            demo.hover === tool.key && "bg-ink/[0.06] text-ink")}>
          <Icon name={tool.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

function useCenters(bar: React.RefObject<HTMLDivElement | null>) {
  const [centers, setCenters] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const next: Record<string, number> = {};
    el.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => { next[b.dataset.tool!] = b.offsetLeft + b.offsetWidth / 2; });
    setCenters(next);
  }, [bar]);
  return centers;
}

const TIP = "ui-tooltip whitespace-nowrap";
const labelOf = (key: string) => TOOLS.find((t) => t.key === key)?.label ?? "";

function TipStage({ children, demo, bar }: { children: React.ReactNode; demo: ReturnType<typeof useHoverDemo>; bar: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative">
        {children}
        <Toolbar demo={demo} bar={bar} />
      </div>
    </div>
  );
}

/* ---------------- Original ---------------- */

export function TipOriginal(props: LabProps) {
  const demo = useHoverDemo(props);
  const bar = useRef<HTMLDivElement>(null);
  const centers = useCenters(bar);
  const tip = useTip(demo.hover, props.speed, { delay: 300, warm: 0, hide: 100 });
  return (
    <TipStage demo={demo} bar={bar}>
      {tip && (
        <div role="tooltip" className={TIP} style={{ position: "absolute", whiteSpace: "nowrap", bottom: "calc(100% + 6px)", left: centers[tip.key] ?? 0, transform: "translateX(-50%)" }}>
          {labelOf(tip.key)}
        </div>
      )}
    </TipStage>
  );
}

/* ---------------- A: calm ---------------- */

export function TipA(props: LabProps) {
  const demo = useHoverDemo(props);
  const bar = useRef<HTMLDivElement>(null);
  const centers = useCenters(bar);
  const tip = useTip(demo.hover, props.speed, { delay: timing.tooltipDelay, warm: timing.tooltipWarm, hide: timing.tooltipHide });
  return (
    <TipStage demo={demo} bar={bar}>
      <AnimatePresence>
        {tip && (
          <div key="anchor" className="absolute bottom-[calc(100%+6px)]" style={{ left: centers[tip.key] ?? 0 }}>
            <motion.div key={tip.instant ? tip.key : "first"} role="tooltip" className={cn(TIP, "relative -translate-x-1/2")} style={{ position: "relative", whiteSpace: "nowrap", transformOrigin: "50% 100%" }}
              initial={tip.instant ? false : { opacity: 0, scale: 0.98, y: 2 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: dur.fast, ease: ease.out } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}>
              {labelOf(tip.key)}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </TipStage>
  );
}

/* ---------------- B: alive ---------------- */

/** one tooltip for the whole toolbar: it grows out of the first tool, then travels and resizes between tools */
export function TipB(props: LabProps) {
  const demo = useHoverDemo(props);
  const bar = useRef<HTMLDivElement>(null);
  const centers = useCenters(bar);
  const tip = useTip(demo.hover, props.speed, { delay: timing.tooltipDelay, warm: timing.tooltipWarm, hide: timing.tooltipHide });
  const measure = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const last = useRef<string | null>(null);
  const [dir, setDir] = useState(1);
  useLayoutEffect(() => {
    if (!tip) { last.current = null; return; }
    if (measure.current) setWidth(measure.current.offsetWidth + 12);
    if (last.current && last.current !== tip.key) {
      const from = TOOLS.findIndex((t) => t.key === last.current);
      setDir(TOOLS.findIndex((t) => t.key === tip.key) > from ? 1 : -1);
    }
    last.current = tip.key;
  }, [tip]);
  const center = tip ? centers[tip.key] ?? 0 : 0;
  const box = tip && width ? { start: center - width / 2, end: center + width / 2 } : null;
  const stretch = useStretch(box, !tip?.instant);
  return (
    <TipStage demo={demo} bar={bar}>
      <span ref={measure} aria-hidden className="invisible absolute whitespace-nowrap text-[12px] font-[425]">{tip ? labelOf(tip.key) : ""}</span>
      <AnimatePresence>
        {tip && box && (
          <motion.div key="tip" role="tooltip" className={cn(TIP, "overflow-hidden px-0 text-center")}
            style={{ position: "absolute", whiteSpace: "nowrap", bottom: "calc(100% + 6px)", left: stretch.start, width: stretch.size, transformOrigin: "50% 140%" }}
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring.fade }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.span key={tip.key} className="block whitespace-nowrap" custom={dir}
                initial={{ opacity: 0, x: dir * 14, filter: "blur(3px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)", transition: spring.fade }}
                exit={{ opacity: 0, x: dir * -10, filter: "blur(3px)", transition: { duration: dur.exit } }}>
                {labelOf(tip.key)}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </TipStage>
  );
}
