import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { dur, ease, offset, spring } from "@lab/tokens";
import type { LabProps } from "@lab/types";
import "@/styles/composer.css";
import { CONTROL, FIELD, LONG_TEXT, PILL, SLOT, Stage, useAutoRows, useLater, useScript, useStacked } from "./kit";

type Glyph = "mic" | "arrow-up" | "stop";

/** the demo's state: type, send (held grey until the "server" has it), the bot works, Stop ends it */
function useComposerDemo({ replayKey, speed }: LabProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [sent, setSent] = useState<{ text: string; n: number } | null>(null);
  const later = useLater(speed);
  const busyEnd = useRef<(() => void) | null>(null);
  const send = (value = text) => {
    if (!value.trim()) return;
    setSent((last) => ({ text: value, n: (last?.n ?? 0) + 1 }));
    setText("");
    setHeld(true);
    later(260, () => {
      setHeld(false);
      setBusy(true);
      busyEnd.current?.();
      busyEnd.current = later(2600, () => setBusy(false));
    });
  };
  const stopTurn = () => {
    busyEnd.current?.();
    setBusy(false);
  };
  const typing: Array<[number, () => void]> = [];
  for (let i = 1; i <= LONG_TEXT.length; i += 1) typing.push([i === 1 ? 500 : 22, () => setText(LONG_TEXT.slice(0, i))]);
  const stopScript = useScript(replayKey, speed, [...typing, [700, () => send(LONG_TEXT)]], () => {
    setText("");
    setBusy(false);
    setHeld(false);
    busyEnd.current?.();
  });
  const filled = Boolean(text.trim()) || held;
  const glyph: Glyph = filled ? "arrow-up" : busy ? "stop" : "mic";
  return { text, setText: (value: string) => { stopScript(); setText(value); }, busy, held, filled, glyph, sent, send: () => { stopScript(); send(); }, stopTurn: () => { stopScript(); stopTurn(); } };
}

type Demo = ReturnType<typeof useComposerDemo>;

function SlotIcon({ glyph, className }: { glyph: Glyph; className?: string }) {
  return glyph === "stop"
    ? <span aria-hidden className={cn("block size-[10px] rounded-[2.5px] bg-current", className)} />
    : <Icon name={glyph} variant="filled" size={16} className={className} />;
}

const slotLabel = (demo: Demo) => (demo.glyph === "stop" ? "stop the reply" : demo.glyph === "arrow-up" ? "send" : "dictate");

/** the field, the + and the buttons; `stacked` puts the text on its own row above them, as the real composer does */
function Row({ demo, stacked, slot, beside, fieldRef, fieldClass, fieldWrap }: {
  demo: Demo; stacked: boolean; slot: ReactNode; beside: ReactNode; fieldRef: React.RefObject<HTMLTextAreaElement | null>;
  fieldClass?: string; fieldWrap?: (field: ReactNode) => ReactNode;
}) {
  const field = (
    <textarea
      ref={fieldRef}
      rows={1}
      value={demo.text}
      aria-label="message dusk bot"
      placeholder="Message dusk bot"
      onChange={(event) => demo.setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          demo.send();
        }
      }}
      className={cn(FIELD, stacked ? "min-h-6 px-1 pt-1 pb-0" : "mt-[3px] mb-px min-h-5 p-0", fieldClass)}
    />
  );
  return (
    <div className={cn("flex items-end gap-2", stacked && "flex-wrap gap-y-2")}>
      <button type="button" aria-label="add files" className={cn(CONTROL, "composer-press")}>
        <Icon name="plus" size={16} />
      </button>
      <div className={cn("min-w-0 flex-1", stacked && "order-first basis-full")}>{fieldWrap ? fieldWrap(field) : field}</div>
      <div className={cn("relative flex items-center gap-2", stacked && "ml-auto")}>
        {beside}
        {slot}
      </div>
    </div>
  );
}

/** the small controls beside the round button: the mic once there is text, Stop while the bot works with text typed */
function Beside({ demo, press }: { demo: Demo; press?: string }) {
  return (
    <>
      {demo.busy && demo.filled && !demo.held && (
        <button type="button" aria-label="stop the reply" onClick={demo.stopTurn} className={cn(CONTROL, press)}>
          <span aria-hidden className="block size-[10px] rounded-[2.5px] bg-current" />
        </button>
      )}
      {demo.filled || demo.busy
        ? <button type="button" aria-label="dictate" className={cn(CONTROL, press)}><Icon name="mic" variant="filled" size={16} /></button>
        : <span aria-hidden className="size-7 shrink-0" />}
    </>
  );
}

const slotAction = (demo: Demo) => (demo.glyph === "stop" ? demo.stopTurn : demo.glyph === "arrow-up" ? demo.send : undefined);

/* ---------------- Original ---------------- */

export function ComposerOriginal(props: LabProps) {
  const demo = useComposerDemo(props);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stacked = useStacked(fieldRef, demo.text);
  useAutoRows(fieldRef, demo.text, stacked);
  const [height, setHeight] = useState<number>();
  const [snap, setSnap] = useState(false);
  const later = useLater(props.speed);
  const lastStacked = useRef(stacked);
  const fieldRect = useRef<DOMRect | null>(null);

  // usePillHeight: opening and closing the stacked layout ride the pill's 300ms spring; once open it follows its text at once
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setHeight(Math.ceil(content.offsetHeight + 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (lastStacked.current === stacked) return;
    lastStacked.current = stacked;
    setSnap(false);
    if (stacked) later(400, () => setSnap(true));
  });
  // useSlideOnChange: the field slides from its old place to its new one on the same spring
  useLayoutEffect(() => {
    const el = fieldRef.current?.parentElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const before = fieldRect.current;
    fieldRect.current = rect;
    if (!before || props.reduced) return;
    const dx = before.left - rect.left, dy = before.top - rect.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 300, easing: getComputedStyle(document.documentElement).getPropertyValue("--composer-spring").trim() || "ease-out" });
  }, [stacked, props.reduced]);

  // the round button: a swap through Send or Stop pops the new glyph in (scale .5, 200ms) and fades the old one out over it
  const [swap, setSwap] = useState({ glyph: demo.glyph, from: null as Glyph | null, swapped: false, n: 0, held: demo.held });
  if (swap.glyph !== demo.glyph) {
    const swapped = (demo.glyph !== "mic" && swap.glyph !== "mic") || swap.glyph === "stop" || swap.held;
    setSwap({ glyph: demo.glyph, from: swap.glyph, swapped, n: swap.n + 1, held: demo.held });
  } else if (swap.held !== demo.held) setSwap({ ...swap, held: demo.held });
  const ghost = swap.swapped && swap.from && swap.from !== demo.glyph ? swap.from : null;

  const slot = (
    <>
      <button
        type="button"
        aria-label={slotLabel(demo)}
        disabled={demo.held}
        onClick={slotAction(demo)}
        data-composer-send={demo.glyph === "arrow-up" ? "" : undefined}
        className="composer-press flex size-7 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        style={demo.held ? { backgroundColor: "var(--color-raised-hover)", color: "var(--color-ink-secondary)" } : { backgroundColor: SLOT.fill, color: SLOT.ink }}
      >
        <SlotIcon key={swap.n} glyph={demo.glyph} className={swap.swapped ? "composer-glyph" : undefined} />
      </button>
      {ghost && (
        <span key={`ghost-${swap.n}`} aria-hidden className="pointer-events-none absolute bottom-0 right-0 z-[1] flex size-7 items-center justify-center" style={{ color: SLOT.ink }}>
          <SlotIcon glyph={ghost} className="composer-glyph-out" />
        </span>
      )}
    </>
  );

  return (
    <Stage>
      <div
        ref={shellRef}
        data-snap={snap ? "" : undefined}
        style={{ height }}
        className={cn("composer-pill", PILL, stacked ? "rounded-[18px]" : "rounded-[22px]")}
      >
        <div ref={contentRef} data-glyph-swap={swap.swapped ? "" : undefined} className="flex shrink-0 flex-col">
          <Row demo={demo} stacked={stacked} fieldRef={fieldRef} slot={slot} beside={<Beside demo={demo} press="composer-press" />} />
        </div>
      </div>
    </Stage>
  );
}

/* ---------------- A: calm ---------------- */

export function ComposerA(props: LabProps) {
  const demo = useComposerDemo(props);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stacked = useStacked(fieldRef, demo.text);
  useAutoRows(fieldRef, demo.text, stacked);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setHeight(Math.ceil(content.offsetHeight + 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const tap = props.reduced ? undefined : { scale: offset.pressScale };

  const slot = (
    <motion.button
      type="button"
      aria-label={slotLabel(demo)}
      disabled={demo.held}
      onClick={slotAction(demo)}
      whileTap={tap}
      transition={{ duration: dur.press, ease: ease.out }}
      className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full transition-[background-color,color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      style={demo.held ? { backgroundColor: "var(--color-raised-hover)", color: "var(--color-ink-secondary)" } : { backgroundColor: SLOT.fill, color: SLOT.ink }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={demo.glyph}
          className="flex items-center justify-center"
          initial={{ opacity: 0, y: offset.swapIn, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: dur.swap, ease: ease.out } }}
          exit={{ opacity: 0, y: offset.swapOut, filter: "blur(2px)", transition: { duration: dur.exit, ease: ease.out } }}
        >
          <SlotIcon glyph={demo.glyph} />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );

  return (
    <Stage>
      <motion.div
        initial={false}
        animate={{ height: height ?? "auto", borderRadius: stacked ? 18 : 22 }}
        transition={spring.height}
        className={cn(PILL, "overflow-clip")}
      >
        <div ref={contentRef} className="flex shrink-0 flex-col">
          <Row demo={demo} stacked={stacked} fieldRef={fieldRef} slot={slot}
            beside={<Beside demo={demo} />}
            fieldWrap={(field) => <motion.div layout="position" transition={spring.layout}>{field}</motion.div>} />
        </div>
      </motion.div>
    </Stage>
  );
}

/* ---------------- B: alive ---------------- */

/** one progress spring m drives Send into Stop: the arrow turns a quarter and shrinks as the square grows */
function MorphGlyph({ glyph, reduced }: { glyph: Glyph; reduced: boolean }) {
  const m = useMotionValue(glyph === "stop" ? 1 : 0);
  const [shown, setShown] = useState<Exclude<Glyph, "stop">>(glyph === "mic" ? "mic" : "arrow-up");
  useLayoutEffect(() => {
    if (glyph !== "stop") setShown(glyph);
    const controls = animate(m, glyph === "stop" ? 1 : 0, reduced ? { duration: 0.12 } : spring.pop);
    return () => controls.stop();
  }, [glyph, m, reduced]);
  const outScale = useTransform(m, [0, 1], [1, 0]);
  const outRotate = useTransform(m, [0, 1], [0, 90]);
  const outOpacity = useTransform(m, [0, 0.6], [1, 0]);
  const inScale = useTransform(m, [0, 1], [0.4, 1]);
  const inOpacity = useTransform(m, [0.3, 1], [0, 1]);
  return (
    <span className="relative flex size-4 items-center justify-center">
      <motion.span className="absolute inset-0 flex items-center justify-center" style={reduced ? { opacity: outOpacity } : { scale: outScale, rotate: outRotate, opacity: outOpacity }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={shown}
            className="flex"
            initial={{ opacity: 0, y: offset.swapIn, filter: "blur(3px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: spring.fade }}
            exit={{ opacity: 0, y: -10, filter: "blur(2px)", transition: { duration: dur.exit, ease: ease.out } }}
          >
            <Icon name={shown} variant="filled" size={16} />
          </motion.span>
        </AnimatePresence>
      </motion.span>
      <motion.span aria-hidden className="block size-[10px] rounded-[2.5px] bg-current" style={reduced ? { opacity: inOpacity } : { scale: inScale, opacity: inOpacity }} />
    </span>
  );
}

/** while the bot works, a short arc runs round the Stop button: the work is visible where you would stop it */
function WorkRing({ on }: { on: boolean }) {
  return (
    <AnimatePresence>
      {on && (
        <motion.svg
          key="ring"
          aria-hidden
          viewBox="0 0 36 36"
          className="pointer-events-none absolute -inset-1 size-9 motion-safe:animate-[spin_1.1s_linear_infinite] [:root[data-reduced-motion=true]_&]:animate-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: dur.swap, ease: ease.out } }}
          exit={{ opacity: 0, transition: { duration: dur.exit } }}
        >
          <circle cx="18" cy="18" r="16.5" fill="none" stroke={SLOT.fill} strokeOpacity="0.22" strokeWidth="1.5" />
          <circle cx="18" cy="18" r="16.5" fill="none" stroke={SLOT.fill} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="22 82" />
        </motion.svg>
      )}
    </AnimatePresence>
  );
}

export function ComposerB(props: LabProps) {
  const demo = useComposerDemo(props);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stacked = useStacked(fieldRef, demo.text);
  useAutoRows(fieldRef, demo.text, stacked);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setHeight(Math.ceil(content.offsetHeight + 16));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const slot = (
    <motion.button
      type="button"
      aria-label={slotLabel(demo)}
      disabled={demo.held}
      onClick={slotAction(demo)}
      whileTap={props.reduced ? undefined : { scale: 0.94 }}
      transition={spring.pop}
      className="relative flex size-7 shrink-0 items-center justify-center rounded-full transition-[background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      style={demo.held ? { backgroundColor: "var(--color-raised-hover)", color: "var(--color-ink-secondary)" } : { backgroundColor: SLOT.fill, color: SLOT.ink }}
    >
      <MorphGlyph glyph={demo.glyph} reduced={props.reduced} />
      <WorkRing on={demo.busy && !demo.filled} />
    </motion.button>
  );

  return (
    <Stage>
      <motion.div
        initial={false}
        animate={{ height: height ?? "auto", borderRadius: stacked ? 18 : 22 }}
        transition={spring.settle}
        className={PILL}
      >
        <div ref={contentRef} className="flex shrink-0 flex-col">
          <Row demo={demo} stacked={stacked} fieldRef={fieldRef} slot={slot}
            beside={<Beside demo={demo} />}
            fieldWrap={(field) => (
              <motion.div layout="position" transition={spring.settle} className="relative">
                {field}
                {/* the sent words lift off the field toward the thread as it clears */}
                <AnimatePresence>
                  {demo.sent && (
                    <motion.p
                      key={demo.sent.n}
                      aria-hidden
                      className="pointer-events-none absolute inset-x-1 bottom-0 line-clamp-2 text-[14px] leading-5 tracking-[0.01em] text-ink"
                      initial={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      animate={props.reduced ? { opacity: 0, transition: { duration: dur.fast } } : { opacity: 0, y: -26, filter: `blur(${offset.blurIn}px)`, transition: { duration: dur.d320, ease: ease.out } }}
                    >
                      {demo.sent.text}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>
            )} />
        </div>
      </motion.div>
    </Stage>
  );
}
