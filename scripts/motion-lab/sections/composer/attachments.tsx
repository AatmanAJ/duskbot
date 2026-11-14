import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { dur, ease, ms, offset, spring } from "@lab/tokens";
import type { LabProps } from "@lab/types";
import "@/styles/composer.css";
import { CONTROL, FIELD, PILL, SLOT, Stage, useLater, useScript } from "./kit";

type Tile = { id: number; kind: "image" | "file"; name: string; size: string; progress: number; tone: string };

const PRESETS: Array<Omit<Tile, "id" | "progress">> = [
  { kind: "image", name: "whiteboard.png", size: "1.2 MB", tone: "linear-gradient(135deg,#f6d365,#fda085)" },
  { kind: "image", name: "receipt.jpg", size: "640 KB", tone: "linear-gradient(135deg,#a1c4fd,#c2e9fb)" },
  { kind: "file", name: "Q4 launch plan.pdf", size: "312 KB", tone: "" },
  { kind: "image", name: "screenshot.png", size: "880 KB", tone: "linear-gradient(135deg,#d4fc79,#96e6a1)" },
];

function useAttachDemo({ replayKey, speed }: LabProps) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const next = useRef(0);
  const later = useLater(speed);
  const add = () => {
    const id = next.current++;
    const preset = PRESETS[id % PRESETS.length]!;
    setTiles((all) => [...all, { ...preset, id, progress: 0 }]);
    [0.35, 0.7, 1].forEach((p, i) => later(260 + i * 300, () => setTiles((all) => all.map((t) => (t.id === id ? { ...t, progress: p } : t)))));
  };
  const remove = (id: number) => setTiles((all) => all.filter((t) => t.id !== id));
  const stop = useScript(replayKey, speed, [[500, add], [450, add], [550, add], [1900, () => setTiles((all) => all.slice(1))]], () => { setTiles([]); next.current = 0; });
  return { tiles, add: () => { stop(); add(); }, remove: (id: number) => { stop(); remove(id); } };
}

type Demo = ReturnType<typeof useAttachDemo>;

/** the upload stroke round a tile, as .upload-ring: eases between reports, fades when done */
function Ring({ progress, size = 22 }: { progress: number; size?: number }) {
  const r = size / 2 - 1.5;
  return (
    <svg aria-hidden viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="upload-ring -rotate-90" data-leaving={progress >= 1 ? "" : undefined}>
      <circle cx={size / 2} cy={size / 2} r={r} pathLength={100} className="upload-ring-stroke" style={{ strokeDashoffset: 100 - progress * 100 }} />
    </svg>
  );
}

function TileBody({ tile, demo }: { tile: Tile; demo: Demo }) {
  const remove = (
    <button type="button" onClick={() => demo.remove(tile.id)} aria-label={`remove ${tile.name}`}
      className="absolute end-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-ink text-app opacity-0 transition-opacity duration-[120ms] group-hover/tile:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus">
      <Icon name="close" size={12} />
    </button>
  );
  if (tile.kind === "image") {
    return (
      <div role="listitem" aria-label={tile.name} className="group/tile relative size-14 shrink-0 overflow-hidden rounded-[10px] border-[0.5px] border-ink/12 bg-composer">
        <div className={cn("size-full transition-opacity duration-[180ms]", tile.progress < 1 && "opacity-60")} style={{ background: tile.tone }} />
        <span className="absolute bottom-1 end-1 flex">{tile.progress < 1 && <Ring progress={tile.progress} size={20} />}</span>
        {remove}
      </div>
    );
  }
  return (
    <div role="listitem" aria-label={tile.name} className="group/tile relative flex h-14 w-[188px] shrink-0 items-center gap-2 rounded-[10px] bg-composer p-2 shadow-[0_0_0_0.5px_rgb(28_28_28/0.08),0_1px_4px_rgb(28_28_28/0.07)]">
      <span className="flex h-10 w-8 shrink-0 items-center justify-center rounded-[6px] bg-ink/[0.05] text-ink/50"><Icon name="file-list" size={14} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[18px] font-medium text-ink">{tile.name}</span>
        <span className="block truncate text-[12px] leading-4 text-ink/60">{tile.size}</span>
      </span>
      {tile.progress < 1 && <Ring progress={tile.progress} />}
      {remove}
    </div>
  );
}

/** the composer around the strip: field above the buttons once anything is attached */
function Shell({ demo, strip, height, contentRef, radiusClass, motionShell }: {
  demo: Demo; strip: React.ReactNode; height?: number; contentRef: React.RefObject<HTMLDivElement | null>;
  radiusClass?: string; motionShell?: { transition: object };
}) {
  const stacked = demo.tiles.length > 0;
  const body = (
    <div ref={contentRef} className="flex shrink-0 flex-col">
      {strip}
      <div className={cn("flex items-end gap-2", stacked && "flex-wrap gap-y-2")}>
        <button type="button" aria-label="attach a file" onClick={demo.add} className={cn(CONTROL, "composer-press")}>
          <Icon name="plus" size={16} />
        </button>
        <div className={cn("min-w-0 flex-1", stacked && "order-first basis-full")}>
          <textarea rows={1} aria-label="message dusk bot" placeholder={stacked ? "Add a message" : "Press + to attach"} className={cn(FIELD, stacked ? "min-h-6 px-1 pt-1" : "mt-[3px] mb-px min-h-5 p-0")} />
        </div>
        <div className={cn("flex items-center gap-2", stacked && "ml-auto")}>
          {stacked ? <button type="button" aria-label="dictate" className={CONTROL}><Icon name="mic" variant="filled" size={16} /></button> : <span aria-hidden className="size-7" />}
          <button type="button" aria-label={stacked ? "send" : "dictate"} className="composer-press flex size-7 items-center justify-center rounded-full" style={{ backgroundColor: SLOT.fill, color: SLOT.ink }}>
            <Icon name={stacked ? "arrow-up" : "mic"} variant="filled" size={16} />
          </button>
        </div>
      </div>
    </div>
  );
  if (motionShell) {
    return (
      <motion.div initial={false} animate={{ height: height ?? "auto", borderRadius: stacked ? 18 : 22 }} transition={motionShell.transition} className={cn(PILL, "overflow-clip")}>
        {body}
      </motion.div>
    );
  }
  return <div style={{ height }} className={cn("composer-pill", PILL, radiusClass, stacked ? "rounded-[18px]" : "rounded-[22px]")}>{body}</div>;
}

function useHeight(ref: React.RefObject<HTMLDivElement | null>) {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(Math.ceil(el.offsetHeight + 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

const STRIP = "-mx-[9px] -mt-1.5 flex min-w-0 flex-nowrap gap-2 overflow-x-auto px-[9px] pt-1.5 pb-2 [scrollbar-width:none]";

/* ---------------- Original ---------------- */

export function AttachOriginal(props: LabProps) {
  const demo = useAttachDemo(props);
  const contentRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const height = useHeight(contentRef);
  const shown = demo.tiles.length > 0;
  // the strip rides the pill's top edge while the pill opens: translateY(grow) to none, 300ms on the composer spring
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const content = contentRef.current;
    const shell = content?.parentElement;
    if (!shown || !strip || !content || !shell || props.reduced) return;
    const grow = content.offsetHeight + 16 - shell.offsetHeight;
    if (grow <= 0) return;
    const easing = getComputedStyle(document.documentElement).getPropertyValue("--composer-spring").trim() || "ease-out";
    strip.animate([{ transform: `translateY(${grow}px)` }, { transform: "none" }], { duration: 300, easing });
  }, [shown, props.reduced]);
  const strip = shown && (
    <div ref={stripRef} className="mt-0.5 mb-0.5 flex min-w-0 flex-col">
      <div role="list" aria-label="attachments" className={STRIP}>
        {demo.tiles.map((tile) => <TileBody key={tile.id} tile={tile} demo={demo} />)}
      </div>
    </div>
  );
  return <Stage><Shell demo={demo} strip={strip} height={height} contentRef={contentRef} /></Stage>;
}

/* ---------------- A: calm ---------------- */

export function AttachA(props: LabProps) {
  const demo = useAttachDemo(props);
  const contentRef = useRef<HTMLDivElement>(null);
  const height = useHeight(contentRef);
  const strip = (
    <AnimatePresence initial={false}>
      {demo.tiles.length > 0 && (
        <motion.div key="strip" className="mt-0.5 mb-0.5" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.fast } }} exit={{ opacity: 0, transition: { duration: dur.exit } }}>
          <div role="list" aria-label="attachments" className={STRIP}>
            <AnimatePresence mode="popLayout" initial={false}>
              {demo.tiles.map((tile) => (
                <motion.div key={tile.id} layout="position"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: ease.out } }}
                  exit={{ opacity: 0, scale: 0.95, transition: { duration: dur.exit, ease: ease.out } }}
                  transition={{ layout: spring.layout }}>
                  <TileBody tile={tile} demo={demo} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return <Stage><Shell demo={demo} strip={strip} height={height} contentRef={contentRef} motionShell={{ transition: spring.height }} /></Stage>;
}

/* ---------------- B: alive ---------------- */

function DoneCheck({ tile, speed }: { tile: Tile; speed: number }) {
  const [gone, setGone] = useState(false);
  return (
    <AnimatePresence>
      {tile.progress >= 1 && !gone && (
        <motion.span key="done" aria-hidden className="absolute bottom-1 end-1 flex size-5 items-center justify-center rounded-full text-white" style={{ backgroundColor: SLOT.fill }}
          initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1, transition: spring.pop }}
          exit={{ opacity: 0, scale: 0.9, transition: { duration: dur.exit } }}
          onAnimationComplete={() => window.setTimeout(() => setGone(true), ms(700, speed))}>
          <Icon name="check" size={12} />
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function AttachB(props: LabProps) {
  const demo = useAttachDemo(props);
  const contentRef = useRef<HTMLDivElement>(null);
  const height = useHeight(contentRef);
  const strip = (
    <AnimatePresence initial={false}>
      {demo.tiles.length > 0 && (
        <motion.div key="strip" className="mt-0.5 mb-0.5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: spring.settle }} exit={{ opacity: 0, transition: { duration: dur.exit } }}>
          <div role="list" aria-label="attachments" className={STRIP}>
            <AnimatePresence mode="popLayout" initial={false}>
              {demo.tiles.map((tile) => (
                <motion.div key={tile.id} layout="position" className="relative"
                  initial={{ opacity: 0, y: offset.swapIn, scale: 0.92, filter: `blur(${offset.blurIn}px)` }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: spring.pop }}
                  exit={{ opacity: 0, scale: 0.9, filter: `blur(${offset.blurOut}px)`, transition: { duration: dur.exit, ease: ease.out } }}
                  transition={{ layout: spring.settle }}>
                  <TileBody tile={tile} demo={demo} />
                  {tile.kind === "image" && <DoneCheck tile={tile} speed={props.speed} />}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
  return <Stage><Shell demo={demo} strip={strip} height={height} contentRef={contentRef} motionShell={{ transition: spring.settle }} /></Stage>;
}
