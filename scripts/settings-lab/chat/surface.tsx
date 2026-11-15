import {
  animate, AnimatePresence, motion, useAnimationFrame, useMotionValue,
  type MotionValue, type Transition,
} from "motion/react";
import {
  createContext, use, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject,
} from "react";
import { MausAvatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { grokUserBubbleFill, SIMPLE_BOT_BUBBLE, SIMPLE_BUBBLE_TEXT, SIMPLE_USER_BUBBLE } from "@/components/chat-bubble";
import { userBubbleStyle } from "@/lib/user-bubble-tone";
import { SIMPLE_COMPOSER, SIMPLE_CONTROL, slotColors } from "@/components/composer-simple";
import { cn } from "@/lib/cn";
import { useFakeBot, useSteadyWords, type FakeBot, type Kind, type Msg } from "./engine";
import "../../../src/components/chat.css";
import "./chat-lab.css";

export type ChatLabProps = { speed: number; reduced: boolean; skin: "grok" | "grok-dark"; replayKey: number };

/** How one variant moves the same chat. Every field picks between the parts the app already has. */
export type Spec = {
  /** the person's bubble: inserted whole while the view glides, rising from below, or carried out of the composer */
  send: "glide" | "rise" | "morph";
  /** the reply: landing whole after Typing (the app today), or drawn as it streams in one of these ways */
  reply: "whole" | "grow" | "fade-rise" | "typing-bubble" | "in-bubble";
  /** how streamed words show: word by word at a steady cadence, a plain smooth append, or words with a caret */
  stream: "none" | "word-fade" | "smooth" | "caret";
  /** the copy and retry row: on hover only, or faded in after the last word into room kept for it from the start */
  actions: "hover" | "after";
  /** how the view follows a new row at the end */
  follow: Transition;
  /** px between the last row and the composer, beyond the status line's own slot */
  gap: number;
  /** the status line says Typing while a reply is written (the app) or keeps only the mascot */
  lineWhileWriting: "typing" | "mascot";
  /** the reply's words arrive all at once when it is written, instead of streaming in */
  instant?: boolean;
};

const BOT = { name: "Nova", color: "blue" as const };
const SLOT = slotColors(BOT.color, false);
/** the person's bubble in one flat tone of the bot's colour, as ChatView paints it */
const MINE: CSSProperties = (() => {
  const { backgroundImage: _flat, ...rest } = userBubbleStyle(BOT.color, { flat: true });
  const grok = grokUserBubbleFill(BOT.color);
  return grok ? { ...rest, backgroundColor: `var(--grok-bubble, ${String(rest.backgroundColor)})`, "--grok-bubble-fill": grok } as CSSProperties : rest;
})();
const QUINT = [0.23, 1, 0.32, 1] as const;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** the app's arrival curve: 240ms on its quint */
export const APP_FOLLOW: Transition = { duration: 0.24, ease: QUINT };
export const SOFT_FOLLOW: Transition = { type: "spring", stiffness: 260, damping: 30, mass: 1 };
export const LAYOUT_FOLLOW: Transition = { type: "spring", bounce: 0, visualDuration: 0.3 };
const STREAM_BOX: Transition = { type: "spring", stiffness: 420, damping: 36, mass: 1 };
const FADE: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 1 };
/** the composer dock: its 52px pill and 16px under it */
const DOCK_PX = 68;
const LINE_EXIT: Transition = { duration: 0.14, ease: EASE_OUT };

type Ctx = { spec: Spec; reduced: boolean; fresh: (key: string) => boolean; launch: RefObject<Launch | null>; maxWidth: number;
  /** a reply whose engine finished but whose words are still being shown */
  onRevealing: (key: string, revealing: boolean) => void };
type Launch = { key: string; x: number; y: number; scale: number };
const SurfaceCtx = createContext<Ctx | null>(null);
const useSurface = () => use(SurfaceCtx)!;

/** true once `on` has held for `ms` of lab time */
function useLabDelay(on: boolean, ms: number): boolean {
  const [ready, setReady] = useState(false);
  const waited = useRef(0);
  useAnimationFrame((_, delta) => {
    if (!on) { if (waited.current) waited.current = 0; return; }
    if (ready) return;
    waited.current += Math.min(delta, 100);
    if (waited.current >= ms) setReady(true);
  });
  if (!on && ready) setReady(false);
  return on && ready;
}

export function ChatSurface({ spec, reduced, replayKey }: ChatLabProps & { spec: Spec }) {
  const bot = useFakeBot();
  const known = useRef(new Set(bot.messages.map((m) => m.key)));
  const fresh = useCallback((key: string) => !known.current.has(key), []);
  const launch = useRef<Launch | null>(null);
  const [text, setText] = useState("");
  const [maxWidth, setMaxWidth] = useState(560);
  const [revealing, setRevealing] = useState<string | null>(null);
  const onRevealing = useCallback((key: string, on: boolean) => setRevealing((now) => on ? key : now === key ? null : now), []);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    bot.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a replay restarts the thread once
  }, [replayKey]);

  const scroller = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  useFollow(scroller, column, y, spec.follow, reduced);

  useLayoutEffect(() => {
    const el = column.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 32;
      setMaxWidth(Math.max(200, Math.min(560, w * 0.8, w - 82)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const field = useRef<HTMLTextAreaElement>(null);
  const submit = (kind: Kind = "sample", body = text) => {
    const words = body.trim();
    if (!words) return;
    const el = field.current;
    if (el && spec.send === "morph") {
      const r = el.getBoundingClientRect();
      const s = r.width / el.offsetWidth || 1;
      const cs = getComputedStyle(el);
      launch.current = { key: "", x: r.left + parseFloat(cs.paddingLeft) * s, y: r.top + parseFloat(cs.paddingTop) * s, scale: s };
    } else launch.current = null;
    setText("");
    bot.send(words, kind);
  };

  const ctx: Ctx = { spec, reduced, fresh, launch, maxWidth, onRevealing };
  const streaming = bot.messages.some((m) => m.role === "bot" && m.state === "streaming");
  const pendingReply = bot.busy && !streaming && (spec.reply === "typing-bubble" || spec.reply === "in-bubble");

  return (
    <SurfaceCtx value={ctx}>
      <div className="chatlab">
        <aside className="replica-side chatlab-side" aria-label="Bots">
          <div className="replica-traffic" aria-hidden="true"><span /><span /><span /></div>
          <button type="button" className="replica-row"><Icon name="pencil-square" size={15} />New chat</button>
          <p className="replica-label">Bots</p>
          {[["Nova", "blue"], ["Quill", "purple"], ["Juno", "pink"], ["Rivet", "orange"]].map(([name, color], i) => (
            <button key={name} type="button" className="replica-bot" aria-current={i === 0 ? "page" : undefined}>
              <MausAvatar color={color as "blue"} size={22} animated={false} />
              <span className="replica-bot-text"><span>{name}</span></span>
            </button>
          ))}
        </aside>
        <section className="chatlab-pane" aria-label="Chat with Nova">
          <header className="chatlab-head">
            <span className="chatlab-pill"><MausAvatar color={BOT.color} size={22} animated={false} />Nova</span>
            <DemoBar bot={bot} onSend={(kind, body) => submit(kind, body)} />
          </header>
          <div ref={scroller} className="chatlab-scroller" data-lab-scroller="">
            <div className="chatlab-clip">
              <motion.div ref={column} className="chatlab-column chat-column" style={{ y, paddingBottom: DOCK_PX + spec.gap }}>
                {[
                  ...bot.messages.map((m) => m.role === "user"
                    ? <UserRow key={m.key} msg={m} />
                    : <BotRow key={m.key} msg={m} bot={bot} />),
                  ...(pendingReply ? [<BotRow key={bot.nextReplyKey} msg={null} bot={bot} />] : []),
                ]}
                <StatusSlot bot={bot} revealing={Boolean(revealing)} />
              </motion.div>
            </div>
          </div>
          <Composer field={field} text={text} setText={setText} busy={bot.busy} onSend={() => submit()} onStop={bot.stop} />
        </section>
      </div>
    </SurfaceCtx>
  );
}

/** A transcript resting at its end scrolls to the new end in the frame a row lands, and the column glides up from where
 * it was drawn; a box growing in place (a streaming bubble) keeps the end pinned frame by frame. Scrolled up, nothing moves. */
function useFollow(scroller: RefObject<HTMLDivElement | null>, column: RefObject<HTMLDivElement | null>, y: MotionValue<number>, follow: Transition, reduced: boolean) {
  const last = useRef<{ max: number; pinned: boolean; set: number } | null>(null);
  const anim = useRef<ReturnType<typeof animate> | null>(null);
  const measure = useCallback((glide: boolean) => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const prev = last.current;
    if (!prev) { el.scrollTop = max; last.current = { max, pinned: true, set: el.scrollTop }; return; }
    if (!prev.pinned) { prev.max = max; return; }
    const delta = max - prev.max;
    el.scrollTop = max;
    prev.set = el.scrollTop;
    prev.max = max;
    if (glide && delta > 0.5 && !reduced) {
      const from = y.get() + delta;
      anim.current?.stop();
      y.jump(from);
      anim.current = animate(y, 0, follow);
    }
  }, [scroller, y, follow, reduced]);
  useLayoutEffect(() => measure(true));
  useLayoutEffect(() => {
    const el = scroller.current, col = column.current;
    if (!el || !col) return;
    const ro = new ResizeObserver(() => measure(false));
    ro.observe(col);
    // only the person's own scrolling unpins: the scroll event of a pin lands a frame later, when the end has moved on
    const onScroll = () => {
      const state = last.current;
      if (!state || Math.abs(el.scrollTop - state.set) < 2) return;
      state.pinned = el.scrollTop >= el.scrollHeight - el.clientHeight - 4;
      state.set = el.scrollTop;
      if (state.pinned) state.max = el.scrollHeight - el.clientHeight;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", onScroll); };
  }, [scroller, column, measure]);
}

function UserRow({ msg }: { msg: Msg }) {
  const { spec, reduced, fresh, launch } = useSurface();
  const isNew = useRef(fresh(msg.key)).current;
  const bubble = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0), fill = useMotionValue(1);
  useLayoutEffect(() => {
    if (!isNew || reduced) return;
    const el = bubble.current;
    if (spec.send === "morph" && launch.current && el) {
      const from = launch.current;
      launch.current = null;
      const r = el.getBoundingClientRect();
      const s = from.scale;
      // the words leave the field where they were typed and settle into the bubble's text box
      x.jump((from.x - (r.left + 12 * s)) / s);
      y.jump((from.y - (r.top + 7 * s)) / s);
      fill.jump(0);
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
      animate(y, 0, { type: "spring", stiffness: 300, damping: 30 });
      animate(fill, 1, { duration: 0.22, ease: EASE_OUT, delay: 0.04 });
    } else if (spec.send === "rise") {
      y.jump(16);
      fill.jump(0);
      animate(y, 0, FADE);
      animate(fill, 1, { duration: 0.18, ease: EASE_OUT });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- an entrance plays once, on mount
  }, []);
  const morph = spec.send === "morph";
  return (
    <div className="chatlab-row chatlab-row-user" data-lab-row={msg.key}>
      <motion.div ref={bubble} data-chat-bubble="simple" style={{ ...(morph ? { color: MINE.color } : MINE), x, y, opacity: morph ? 1 : fill }}
        className={cn("chatlab-user", morph ? cn(SIMPLE_USER_BUBBLE, "chatlab-user-morph") : SIMPLE_USER_BUBBLE)}>
        {morph && <motion.span aria-hidden="true" data-chat-bubble="simple" className={cn("chatlab-user-fill", SIMPLE_USER_BUBBLE)} style={{ ...MINE, opacity: fill }} />}
        <span className="relative">{msg.text}</span>
      </motion.div>
    </div>
  );
}

function BotRow({ msg, bot }: { msg: Msg | null; bot: FakeBot }) {
  const { spec, fresh } = useSurface();
  const key = msg?.key ?? bot.nextReplyKey;
  const isNew = useRef(fresh(key)).current;
  if (!isNew && msg) return <div className="chatlab-row" data-lab-row={key}><StaticBubble text={msg.text} /></div>;
  if (spec.reply === "whole") return <WholeReply msg={msg} />;
  return <StreamReply msg={msg} bot={bot} />;
}

function StaticBubble({ text }: { text: string }) {
  const { maxWidth } = useSurface();
  return (
    <div className="chatlab-bubble-hover">
      <div data-chat-bubble="simple" className={cn(SIMPLE_BOT_BUBBLE, "chat-text w-fit whitespace-pre-wrap rounded-es-[6px]")} style={{ maxWidth }}>{text}</div>
      <Actions hover />
    </div>
  );
}

/** the app today: the reply is held while it is written, the line says Typing, and the whole bubble lands 80ms after the
 * line starts leaving */
function WholeReply({ msg }: { msg: Msg | null }) {
  const settled = Boolean(msg && msg.state !== "streaming");
  const lands = useLabDelay(settled, msg?.state === "stopped" ? 0 : 80);
  if (!msg || !lands) return null;
  return <div className="chatlab-row" data-lab-row={msg.key}><StaticBubble text={msg.text} /></div>;
}

function StreamReply({ msg, bot }: { msg: Msg | null; bot: FakeBot }) {
  const { spec, reduced, maxWidth, onRevealing } = useSurface();
  const text = msg?.text ?? "";
  const { shown, total } = useSteadyWords(text, { minWordMs: spec.stream === "smooth" ? 22 : 40 });
  const finished = Boolean(msg && msg.state !== "streaming");
  const caughtUp = finished && (spec.instant || shown >= total || msg?.state === "stopped");
  const all = text.split(/(?<=\s)/).filter(Boolean);
  const words = spec.instant ? (finished ? all : []) : all.slice(0, msg?.state === "stopped" ? total : shown);
  const placeholder = !msg || (!words.length && !finished);
  const after = useLabDelay(caughtUp && msg?.state === "done", 140);
  const rowKey = msg?.key ?? bot.nextReplyKey;
  const behind = Boolean(msg && msg.state === "done" && !caughtUp);
  useEffect(() => {
    onRevealing(rowKey, behind);
    return () => onRevealing(rowKey, false);
  }, [rowKey, behind, onRevealing]);

  const entrance = reduced ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : spec.reply === "grow" ? { initial: { opacity: 0, scale: 0.94 }, animate: { opacity: 1, scale: 1 } }
    : spec.reply === "fade-rise" ? { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }
    : { initial: { opacity: 0, scale: 0.97 }, animate: { opacity: 1, scale: 1 } };

  // a pending row with nothing to show yet only exists for the bubble that carries the thinking
  if (!msg && spec.reply !== "typing-bubble" && spec.reply !== "in-bubble") return null;
  if (msg && !words.length && !finished && spec.reply !== "typing-bubble" && spec.reply !== "in-bubble") return null;

  return (
    <div className="chatlab-row" data-lab-row={msg?.key ?? bot.nextReplyKey}>
      <motion.div className="chatlab-stream-wrap" style={{ transformOrigin: "0% 100%" }}
        initial={entrance.initial} animate={entrance.animate} transition={FADE}>
        <GrowBox maxWidth={maxWidth}>
          <AnimatePresence initial={false}>
            {placeholder && (
              <motion.span key="wait" className="chatlab-wait" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                {spec.reply === "in-bubble" ? <Shimmer text={bot.tool ?? "Thinking"} /> : <Dots />}
              </motion.span>
            )}
          </AnimatePresence>
          {!placeholder && (
            <span className="chatlab-words">
              {spec.instant ? (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: EASE_OUT, delay: 0.09 }}>{words.join("")}</motion.span>
              ) : spec.stream === "smooth" ? words.join("") : words.map((word, i) => (
                <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, ease: EASE_OUT, delay: 0.09 }}>{word}</motion.span>
              ))}
              {spec.stream === "caret" && !spec.instant && <AnimatePresence>{!caughtUp && (
                <motion.span key="caret" className="chatlab-caret" aria-hidden="true" exit={{ opacity: 0, transition: { duration: 0.12 } }} />
              )}</AnimatePresence>}
            </span>
          )}
        </GrowBox>
        {spec.actions === "after"
          ? <div className="chatlab-actions-slot"><AnimatePresence>{after && <Actions key="a" />}</AnimatePresence></div>
          : caughtUp && msg?.state === "done" && <Actions hover />}
      </motion.div>
    </div>
  );
}

/** the bubble's box follows what is inside it on a spring; the words are measured off to one side so they never wrap
 * to the animated size */
function GrowBox({ children, maxWidth }: { children: ReactNode; maxWidth: number }) {
  const { reduced } = useSurface();
  const inner = useRef<HTMLDivElement>(null);
  const w = useMotionValue(0), h = useMotionValue(0);
  const sized = useRef(false);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const fit = () => {
      const nw = el.offsetWidth + 24, nh = el.offsetHeight + 14;
      if (!sized.current || reduced) { w.jump(nw); h.jump(nh); sized.current = true; return; }
      animate(w, nw, STREAM_BOX);
      animate(h, nh, STREAM_BOX);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, reduced]);
  return (
    <motion.div data-chat-bubble="simple" className={cn(SIMPLE_BOT_BUBBLE, "chatlab-growbox rounded-es-[6px]")} style={{ width: w, height: h }}>
      <div ref={inner} className={cn("chatlab-measure chat-text whitespace-pre-wrap", SIMPLE_BUBBLE_TEXT)} style={{ maxWidth: maxWidth - 24 }}>{children}</div>
    </motion.div>
  );
}

function Dots() {
  return (
    <span className="chatlab-dots" aria-label="Nova is typing">
      {[0, 1, 2].map((i) => <span key={i} style={{ animationDelay: `${i * 160}ms` } as CSSProperties} />)}
    </span>
  );
}

function Shimmer({ text }: { text: string }) {
  return (
    <span className="thinking-shimmer" style={{ "--sheen-period": "2000ms", "--sheen-delay": "0ms" } as CSSProperties}>
      {text}
      <span aria-hidden="true" className="thinking-sheen"><span data-text={text} /></span>
    </span>
  );
}

function Actions({ hover = false }: { hover?: boolean }) {
  const look = "chatlab-action";
  const row = (
    <>
      <button type="button" className={look} aria-label="Copy"><Icon name="copy" size={15} /></button>
      <button type="button" className={look} aria-label="Reply"><Icon name="arrow-left" size={15} /></button>
    </>
  );
  if (hover) return <div className="chatlab-actions chatlab-actions-hover">{row}</div>;
  return (
    <motion.div className="chatlab-actions" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: EASE_OUT }}>{row}</motion.div>
  );
}

/** the mascot's line keeps its slot at the end of the conversation whether it shows or not, so it never moves a row */
function StatusSlot({ bot, revealing }: { bot: FakeBot; revealing: boolean }) {
  const { spec } = useSurface();
  const writing = bot.phase === "streaming" || revealing;
  const working = bot.busy || revealing;
  const quiet = useLabDelay(bot.phase === "thinking", 650);
  const holding = spec.reply === "whole";
  const bubbleCarries = spec.reply === "typing-bubble" || spec.reply === "in-bubble";
  const label = bot.phase === "tool" && !(spec.reply === "in-bubble") ? bot.tool
    : writing ? (holding || spec.lineWhileWriting === "typing" ? "Typing…" : null)
    : bot.phase === "thinking" && quiet && !bubbleCarries ? "Thinking" : null;
  const state = writing ? "streaming" : bot.phase === "tool" ? "searching" : "thinking";
  const stoppedShown = bot.stopped && !working;
  return (
    <div className="chatlab-slot" data-lab-status="">
      <AnimatePresence>
        {working && (
          <motion.div key="line" className="chatlab-line" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: LINE_EXIT }}>
            <MausAvatar color={BOT.color} size={28} state={state} eyeInk="var(--color-app)" />
            <AnimatePresence mode="popLayout" initial={false}>
              {label && (
                <motion.span key={label} className="chatlab-line-text" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4, transition: { duration: 0.08 } }} transition={{ duration: 0.2, ease: EASE_OUT, delay: 0.06 }}>
                  {label === "Typing…" ? label : <Shimmer text={label} />}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        )}
        {stoppedShown && (
          <motion.div key="stopped" role="status" className="chatlab-stopped" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.14 }}>Stopped</motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Composer({ field, text, setText, busy, onSend, onStop }: {
  field: RefObject<HTMLTextAreaElement | null>; text: string; setText: (v: string) => void; busy: boolean; onSend: () => void; onStop: () => void;
}) {
  const filled = Boolean(text.trim());
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSend(); }
  };
  return (
    <div className="chatlab-dock">
      <div className={cn(SIMPLE_COMPOSER, "rounded-[22px]")}>
        <div className="flex items-end gap-2" style={SLOT.vars}>
          <button type="button" className={cn(SIMPLE_CONTROL, "grid shrink-0 place-items-center")} aria-label="Add files"><Icon name="plus" size={16} /></button>
          <textarea ref={field} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
            aria-label="Message Nova" placeholder="Message Nova"
            className="chatlab-field min-w-0 flex-1 resize-none bg-transparent text-[15px] leading-5 text-ink placeholder:text-ink-tertiary" />
          {filled ? (
            <button type="button" onClick={onSend} aria-label="Send" className={cn("composer-press grid size-7 shrink-0 place-items-center rounded-full", SLOT.button.className)} style={SLOT.button.style}>
              <Icon name="arrow-up" variant="filled" size={16} />
            </button>
          ) : busy ? (
            <button type="button" onClick={onStop} aria-label="Stop" className={cn("composer-press grid size-7 shrink-0 place-items-center rounded-full", SLOT.button.className)} style={SLOT.button.style}>
              <span aria-hidden="true" className="block size-[10px] rounded-[2.5px] bg-current" />
            </button>
          ) : (
            <button type="button" aria-label="Dictate" className={cn(SIMPLE_CONTROL, "grid shrink-0 place-items-center")}><Icon name="mic" variant="filled" size={16} /></button>
          )}
        </div>
      </div>
    </div>
  );
}

function DemoBar({ bot, onSend }: { bot: FakeBot; onSend: (kind: Kind, body: string) => void }) {
  const run = (kind: Kind, body: string) => () => onSend(kind, body);
  return (
    <div className="chatlab-demo" role="toolbar" aria-label="Try a reply">
      <button type="button" onClick={run("sample", "Move the dentist to Thursday")}>Send sample</button>
      <button type="button" onClick={run("long", "Plan my week, keep the mornings clear")}>Long reply</button>
      <button type="button" onClick={run("tool", "Anything off on the site?")}>Reply with tool use</button>
      <button type="button" onClick={run("fast", "Did the table get booked?")}>Fast reply</button>
      <button type="button" onClick={bot.stopDemo}>Stop mid-stream</button>
    </div>
  );
}
