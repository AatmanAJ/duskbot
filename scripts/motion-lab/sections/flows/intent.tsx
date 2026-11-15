// cloud intent: "What should the cloud do while you're away?" -> pick an idea -> Start setting it up -> the box becomes the
// chat's composer and the job is sent. Original is a real view transition (one name on the box and the composer, 0.5s
// sheet curve), as CloudIntent.tsx runs it.
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { MausAvatar } from "@/components/Avatar";
import { ArrowUp, CalendarCheck, Eye, Newspaper, Search } from "@/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { ease, ms, offset, reducedFade, spring } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { Again, Canvas, useFlow } from "./kit/kit";

const IDEAS: { id: string; icon: typeof Newspaper; label: LocaleKey; text: LocaleKey }[] = [
  { id: "digest", icon: Newspaper, label: "cloudIntent.idea.digest", text: "cloudIntent.idea.digestText" },
  { id: "watch", icon: Eye, label: "cloudIntent.idea.watch", text: "cloudIntent.idea.watchText" },
  { id: "research", icon: Search, label: "cloudIntent.idea.research", text: "cloudIntent.idea.researchText" },
  { id: "plan", icon: CalendarCheck, label: "cloudIntent.idea.plan", text: "cloudIntent.idea.planText" },
];
type V = { view: "intent" | "chat"; idea: string | null };
const START: V = { view: "intent", idea: null };
const SCRIPT: [number, V][] = [[1100, { view: "intent", idea: "digest" }], [1300, { view: "chat", idea: "digest" }]];

const ideaText = (id: string | null) => (id ? t(IDEAS.find((idea) => idea.id === id)!.text) : "");

function Chips({ idea, onPick }: { idea: string | null; onPick: (id: string) => void }) {
  return <div role="group" aria-label={t("cloudIntent.ideas")} className="mt-3 flex flex-wrap justify-center gap-1.5">
    {IDEAS.map((candidate) => {
      const Icon = candidate.icon, chosen = idea === candidate.id;
      return <button key={candidate.id} type="button" aria-pressed={chosen} onClick={() => onPick(candidate.id)}
        className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
          chosen ? "border-accent/45 bg-accent/10 text-ink" : "border-transparent bg-card/40 text-ink-secondary hover:bg-card hover:text-ink")}>
        <Icon size={12} aria-hidden="true" className={chosen ? "text-accent" : undefined} />{t(candidate.label)}
      </button>;
    })}
  </div>;
}

/** the first-job box: the /setup token, the job, the send button */
function JobBox({ text, onSend, style, layoutId, textId, reduced }: { text: string; onSend: () => void; style?: CSSProperties; layoutId?: string; textId?: string; reduced?: boolean }) {
  const filled = text.length > 0;
  return <motion.div layoutId={layoutId} transition={reduced ? { duration: 0 } : undefined} style={{ ...style, borderRadius: 16 }}
    className="relative rounded-2xl bg-composer py-3 pl-3.5 pr-12 text-start shadow-[0_22px_50px_-30px_rgba(0,0,0,0.65)]">
    <p className="min-h-12 text-[13.5px] leading-[22px]">
      <span className="me-1.5 inline-flex h-[20px] items-center rounded-md bg-accent/[0.14] px-1.5 text-[12px] font-semibold text-accent">/setup</span>
      {filled ? <motion.span layoutId={textId} className="inline">{text}</motion.span> : <span className="text-ink-tertiary">{t("cloudIntent.placeholder")}</span>}
    </p>
    <button type="button" onClick={onSend} disabled={!filled} aria-label={t("cloudIntent.send")}
      className={cn("absolute bottom-2.5 right-2.5 flex size-8 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 ease-out active:scale-95",
        filled ? "bg-accent text-white" : "bg-raised text-ink-secondary")}>
      <ArrowUp size={15} strokeWidth={2.25} aria-hidden="true" />
    </button>
  </motion.div>;
}

function IntentPage({ idea, onPick, onSend, box }: { idea: string | null; onPick: (id: string) => void; onSend: () => void; box: ReactNode }) {
  return <div className="flex h-full flex-col px-5 pt-6 text-center">
    <div className="flex justify-center"><MausAvatar color="green" state={idea ? "listening" : "happy"} size={44} label="dusk bot" /></div>
    <h3 className="mt-3 text-[17px] font-semibold leading-6 tracking-[-0.015em] [text-wrap:balance]">{t("cloudIntent.title")}</h3>
    <div className="mt-4">{box}</div>
    <Chips idea={idea} onPick={onPick} />
    <button type="button" onClick={onSend} className="sr-only">{t("cloudIntent.send")}</button>
  </div>;
}

/** the chat it lands in: the job sent as a message, the composer at the foot */
function ChatPage({ message, composer }: { message: ReactNode; composer: ReactNode }) {
  return <div className="flex h-full flex-col px-4 pb-4 pt-5">
    <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary"><MausAvatar color="green" size={20} label="" />dusk bot</div>
    <div className="flex flex-1 flex-col justify-end gap-2 pb-3">{message}</div>
    {composer}
  </div>;
}

function Composer({ style, layoutId, reduced }: { style?: CSSProperties; layoutId?: string; reduced?: boolean }) {
  return <motion.div layoutId={layoutId} transition={reduced ? { duration: 0 } : undefined} style={{ ...style, borderRadius: 16 }}
    className="relative flex min-h-12 items-center rounded-2xl bg-composer pl-3.5 pr-12 text-[13.5px] text-ink-tertiary shadow-[0_22px_50px_-30px_rgba(0,0,0,0.65)]">
    Message dusk bot
    <span className="absolute right-2.5 flex size-8 items-center justify-center rounded-full bg-raised text-ink-secondary"><ArrowUp size={15} strokeWidth={2.25} aria-hidden="true" /></span>
  </motion.div>;
}

const Bubble = ({ children, className }: { children: ReactNode; className?: string }) =>
  <div className={cn("ms-auto max-w-[85%] rounded-[18px] bg-card px-3.5 py-2 text-start text-[13.5px] leading-[20px]", className)}>{children}</div>;

/** today: document.startViewTransition swaps the views; the box and the composer share one view-transition-name, so the box
 * glides into the composer over 0.5s on the sheet curve while the rest crossfades (root 0.28s). The sent message then rises
 * with the chat's own arrival (12px, 240ms). Reduced motion swaps without a transition. */
function Original(props: LabProps) {
  const name = `flows-intent-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const flow = useFlow<V>(START, props.replayKey, props.speed, []);
  const morph = (apply: () => void) => {
    const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
    if (props.reduced || typeof start !== "function") return apply();
    start.call(document, () => flushSync(apply));
  };
  const send = () => morph(() => flow.go((v) => ({ ...v, view: "chat" })));
  // autoplay: the view transition has to wrap the state change, so this column runs its own two timers
  const morphRef = useRef(morph);
  morphRef.current = morph;
  const { set } = flow;
  useEffect(() => {
    const pick = setTimeout(() => set({ view: "intent", idea: "digest" }), ms(1100, props.speed));
    const go = setTimeout(() => morphRef.current(() => set({ view: "chat", idea: "digest" })), ms(2400, props.speed));
    return () => { clearTimeout(pick); clearTimeout(go); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.replayKey, set]);
  const text = ideaText(flow.state.idea);
  return <Canvas>
    <style>{`::view-transition-group(${name}) { animation-duration: 0.5s; animation-timing-function: cubic-bezier(0.32, 0.72, 0, 1); }`}</style>
    <div className="h-full">
      {flow.state.view === "intent"
        ? <IntentPage idea={flow.state.idea} onPick={(idea) => flow.go({ view: "intent", idea })} onSend={send}
          box={<JobBox text={text} onSend={send} style={{ viewTransitionName: name }} />} />
        : <ChatPage message={<Bubble className="animate-rise">/setup {text}</Bubble>} composer={<Composer style={{ viewTransitionName: name }} />} />}
    </div>
    <Again show={flow.state.view === "chat"} onClick={() => morph(() => flow.go(START))} />
  </Canvas>;
}

/** A: the same glide, as a shared layout element on the sheet curve (0.5s), scoped to its own column (a document view
 * transition freezes the whole page while it runs); the intent page fades out in 120ms, the message rises 8px +200ms */
function A(props: LabProps) {
  const flow = useFlow<V>(START, props.replayKey, props.speed, SCRIPT);
  const r = props.reduced;
  const scope = useId();
  const text = ideaText(flow.state.idea);
  const send = () => flow.go((v) => ({ ...v, view: "chat" }));
  const glide = r ? { duration: 0 } : { duration: 0.5, ease: ease.sheet };
  return <Canvas>
    <LayoutGroup id={scope}>
      <AnimatePresence mode="popLayout" initial={false}>
        {flow.state.view === "intent"
          ? <motion.div key="intent" className="h-full" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            <IntentPage idea={flow.state.idea} onPick={(idea) => flow.go({ view: "intent", idea })} onSend={send}
              box={<motion.div layoutId="box" transition={glide} style={{ borderRadius: 16 }}><JobBox text={text} onSend={send} /></motion.div>} />
          </motion.div>
          : <motion.div key="chat" className="h-full" initial={{ opacity: 1 }}>
            <ChatPage
              message={<motion.div initial={{ opacity: 0, y: r ? 0 : offset.swapIn }} animate={{ opacity: 1, y: 0 }} transition={r ? reducedFade : { ...spring.fade, delay: 0.2 }}><Bubble>/setup {text}</Bubble></motion.div>}
              composer={<motion.div layoutId="box" transition={glide} style={{ borderRadius: 16 }}><Composer /></motion.div>} />
          </motion.div>}
      </AnimatePresence>
    </LayoutGroup>
    <Again show={flow.state.view === "chat"} onClick={() => flow.go(START)} />
  </Canvas>;
}

/** B: the box settles into the composer on spring.soft (260/24) while the job's words lift out of it and become the sent
 * bubble (a second shared element, spring.enter 300/22): what you typed is visibly what got sent */
function B(props: LabProps) {
  const flow = useFlow<V>(START, props.replayKey, props.speed, SCRIPT);
  const r = props.reduced;
  const scope = useId();
  const text = ideaText(flow.state.idea);
  const send = () => flow.go((v) => ({ ...v, view: "chat" }));
  const still = { duration: 0 };
  return <Canvas>
    <LayoutGroup id={scope}>
      <AnimatePresence mode="popLayout" initial={false}>
        {flow.state.view === "intent"
          ? <motion.div key="intent" className="h-full" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
            <IntentPage idea={flow.state.idea} onPick={(idea) => flow.go({ view: "intent", idea })} onSend={send}
              box={<motion.div layoutId="box" transition={r ? still : spring.soft} style={{ borderRadius: 16 }}>
                <JobBox text={text} onSend={send} textId="words" /></motion.div>} />
          </motion.div>
          : <motion.div key="chat" className="h-full">
            <ChatPage
              message={<motion.div layoutId="words" transition={r ? still : spring.enter} style={{ borderRadius: 18 }} className="ms-auto max-w-[85%]">
                <Bubble className="max-w-none">/setup {text}</Bubble></motion.div>}
              composer={<motion.div layoutId="box" transition={r ? still : spring.soft} style={{ borderRadius: 16 }}><Composer /></motion.div>} />
          </motion.div>}
      </AnimatePresence>
    </LayoutGroup>
    <Again show={flow.state.view === "chat"} onClick={() => flow.go(START)} />
  </Canvas>;
}

export const intent: Item = {
  id: "flows-cloud-intent",
  title: "cloud intent -> chat morph",
  surface: "first cloud job (CloudIntent, view transition)",
  height: 380,
  loopMs: 6000,
  notes: {
    original: "real document.startViewTransition: the box and the composer share one view-transition-name; the box glides into the composer 0.5s on the sheet curve while the page crossfades (root 0.28s); the message rises 12px/320ms. Note: a document transition freezes the rest of the window while it runs.",
    a: "calm: the same glide as a shared layout element (0.5s ease.sheet), scoped to its own surface so nothing else freezes; the intent page fades out in 120ms; the sent message rises 8px +200ms on spring.fade.",
    b: "alive: the box settles into the composer on spring.soft 260/24 while the job's words lift out of it into the sent bubble (second shared element, spring.enter 300/22), so what you typed is visibly what was sent.",
  },
  Original, A, B,
};
