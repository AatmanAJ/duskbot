// the "Set up dusk cloud" card in the sidebar footer: steps tick, the segmented progress fills, the next step opens, and
// the last one turns the card into "The cloud is ready". Original uses the app's own classes (animate-rise, check-in,
// progress-fill, animate-pop-in).
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { MausAvatar } from "@/components/Avatar";
import { staggerIndex } from "@/components/onboarding/beats/shared";
import { ArrowRight, Check, ChevronDown } from "@/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { ease, offset, reducedFade, spring, stagger } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { Again, Canvas, DrawCheck, Roll, Swap, useFlow } from "./kit/kit";

const STEPS: { id: string; title: LocaleKey; hint?: LocaleKey; action?: LocaleKey }[] = [
  { id: "cloud", title: "cloudSetup.cloud.title" },
  { id: "job", title: "cloudSetup.job.title", hint: "cloudSetup.job.hint", action: "cloudSetup.job.action" },
  { id: "engine", title: "cloudSetup.engine.title", hint: "cloudSetup.engine.hint", action: "cloudSetup.engine.action" },
  { id: "plan", title: "cloudSetup.plan.title", hint: "cloudSetup.plan.hint", action: "cloudSetup.plan.action" },
];
const TOTAL = STEPS.length;
type C = { done: number; finale: boolean };
const START: C = { done: 1, finale: false };
const SCRIPT: [number, (c: C) => C][] = [
  [1300, (c) => ({ ...c, done: 2 })], [1500, (c) => ({ ...c, done: 3 })], [1500, (c) => ({ ...c, done: 4 })], [900, (c) => ({ ...c, finale: true })],
];

function useCard(props: LabProps) {
  const flow = useFlow<C>(START, props.replayKey, props.speed, SCRIPT);
  const act = () => {
    if (flow.state.done >= TOTAL) return;
    const done = flow.state.done + 1;
    flow.go({ done, finale: false });
    if (done >= TOTAL) flow.later(900, (c: C) => ({ ...c, finale: true }));
  };
  return { ...flow, act };
}

const CARD = "relative w-[264px] overflow-hidden rounded-[18px] border border-ink/[0.08] bg-composer p-3 text-ink";
const PRIMARY = "ui-button ui-button-primary shrink-0 gap-1.5 text-[13px] transition-transform duration-150 ease-out active:scale-[0.97]";
const progressText = (done: number) => t("cloudSetup.progress", { done, total: TOTAL });

function Footer({ children }: { children: ReactNode }) {
  return <Canvas className="items-center justify-end pb-5">{children}</Canvas>;
}

function ReadyBody({ reduced, onDone, motionKey }: { reduced: boolean; onDone: () => void; motionKey: number }) {
  return <>
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--color-success)_16%,transparent),transparent)]" />
    <MausAvatar color="green" state="celebrate" motion={reduced ? "none" : "celebrate"} motionKey={motionKey} size={56} label="dusk bot" />
    <div role="status" className="relative">
      <h2 className="mt-3 text-[15px] font-semibold">{t("cloudSetup.ready.title")}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{t("cloudSetup.ready.body")}</p>
    </div>
    <button type="button" className="ui-button relative mt-4 w-full" onClick={onDone}>{t("cloudSetup.ready.done")}</button>
  </>;
}

function Original(props: LabProps) {
  const { state, act, auto, replay } = useCard(props);
  const current = STEPS[state.done];
  if (state.finale) return <Footer>
    <aside className={cn(CARD, "popover-surface animate-pop-in flex flex-col items-center p-4 pt-5 text-center")}><ReadyBody reduced={props.reduced} onDone={replay} motionKey={props.replayKey + 1} /></aside>
  </Footer>;
  return <Footer>
    <aside className={cn(CARD, "popover-surface animate-pop-in origin-bottom")}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="-my-1 -ms-0.5"><MausAvatar color="blue" state={state.done === TOTAL ? "celebrate" : "idle"} size={22} trackPointer={false} label="" /></span>
        <h2 className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px]">{t("cloudSetup.title")}</h2>
        <span className="text-[12px] tabular-nums text-ink-secondary">{progressText(state.done)}</span>
        <span className="ui-icon-button -mr-1.5 size-6 min-h-0 p-0"><ChevronDown size={14} aria-hidden="true" /></span>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL} aria-valuenow={state.done} className="mt-3 flex gap-1">
        {STEPS.map((_, i) => <span key={i} className="relative h-1 flex-1 rounded-full bg-ink-secondary/20">
          <span data-filled={i < state.done ? "" : undefined} style={staggerIndex(i)} className="progress-fill absolute inset-0 rounded-full bg-success" />
        </span>)}
      </div>
      {current && <div key={current.id} className="animate-rise mt-4">
        <h3 className="text-[14px] font-semibold leading-snug">{t(current.title)}</h3>
        {current.hint && <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{t(current.hint)}</p>}
        {current.action && <div className="mt-3.5 flex"><button type="button" className={PRIMARY} onClick={act}>{t(current.action)}<ArrowRight size={13} aria-hidden="true" /></button></div>}
      </div>}
      <ol className="stagger mt-4 flex flex-col pt-1">
        {STEPS.filter((s) => s !== current).map((s, i) => {
          const done = STEPS.indexOf(s) < state.done;
          return <li key={s.id} className="animate-rise" style={staggerIndex(i)}>
            <div className={cn("-mx-2 flex items-start gap-2.5 px-2 py-1.5 text-[13px] leading-[18px]", done ? "text-ink-secondary" : "text-ink")}>
              {done ? <span className="check-in mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-success text-white"><Check size={10} strokeWidth={3.5} aria-hidden="true" /></span>
                : <span className="mt-px size-4 shrink-0 rounded-full border-[1.5px] border-ink-secondary/45" />}
              {t(s.title)}
            </div>
          </li>;
        })}
      </ol>
    </aside>
    <Again show={!auto} onClick={replay} />
  </Footer>;
}

/** the steps list shared by the variants: rows move to their new place (spring.layout) instead of being redrawn, a step that
 * finishes pops its green mark (spring.pop) and draws its tick */
function Steps({ done, reduced, skip }: { done: number; reduced: boolean; skip?: string }) {
  return <ol className="mt-3.5 flex flex-col">
    {STEPS.filter((s) => s.id !== skip).map((s) => {
      const finished = STEPS.indexOf(s) < done;
      return <motion.li key={s.id} layout={reduced ? false : "position"} transition={spring.layout}
        className={cn("-mx-2 flex items-start gap-2.5 px-2 py-1.5 text-[13px] leading-[18px] transition-colors duration-200", finished ? "text-ink-secondary" : "text-ink")}>
        <span className="relative mt-px grid size-4 shrink-0 place-items-center">
          <span className="absolute inset-0 rounded-full border-[1.5px] border-ink-secondary/45" />
          <AnimatePresence initial={false}>
            {finished && <motion.span key="ok" className="absolute inset-0 grid place-items-center rounded-full bg-success text-white"
              initial={{ opacity: 0, scale: reduced ? 1 : 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={reduced ? reducedFade : spring.pop}>
              <DrawCheck size={10} strokeWidth={3.6} reduced={reduced} delay={0.1} draw={0.24} /></motion.span>}
          </AnimatePresence>
        </span>
        {t(s.title)}
      </motion.li>;
    })}
  </ol>;
}

/** the open step: its title and line swap (8px rise, 4px blur), the card's height springs after it */
function Focus({ id, reduced, onAct, rise = offset.swapIn }: { id: string | undefined; reduced: boolean; onAct: () => void; rise?: number }) {
  const step = STEPS.find((s) => s.id === id);
  return <motion.div layout={!reduced} transition={spring.height} className="overflow-hidden">
    <AnimatePresence mode="popLayout" initial={false}>
      {step && <motion.div key={step.id} className="pt-4"
        initial={{ opacity: 0, y: reduced ? 0 : rise, filter: reduced ? "none" : `blur(${offset.blurIn}px)` }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: reduced ? 0 : offset.swapOut, transition: { duration: 0.12, ease: ease.out } }} transition={reduced ? reducedFade : { ...spring.fade, delay: 0.08 }}>
        <h3 className="text-[14px] font-semibold leading-snug">{t(step.title)}</h3>
        {step.hint && <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{t(step.hint)}</p>}
        {step.action && <div className="mt-3.5 flex"><button type="button" className={PRIMARY} onClick={onAct}>{t(step.action)}<ArrowRight size={13} aria-hidden="true" /></button></div>}
      </motion.div>}
    </AnimatePresence>
  </motion.div>;
}

function Head({ done, reduced, roll }: { done: number; reduced: boolean; roll?: boolean }) {
  return <div className="flex items-center gap-2">
    <span aria-hidden="true" className="-my-1 -ms-0.5"><MausAvatar color="blue" state={done === TOTAL ? "celebrate" : "idle"} size={22} trackPointer={false} label="" /></span>
    <h2 className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px]">{t("cloudSetup.title")}</h2>
    <span className="text-[12px] tabular-nums text-ink-secondary">
      {roll ? <span className="inline-flex items-baseline"><Roll value={String(done)} reduced={reduced} />&nbsp;of {TOTAL} done</span> : <Swap id={done} reduced={reduced}>{progressText(done)}</Swap>}
    </span>
    <span className="ui-icon-button -mr-1.5 size-6 min-h-0 p-0"><ChevronDown size={14} aria-hidden="true" /></span>
  </div>;
}

/** A: the card arrives once (pop), then only what changed moves: segments fill on scaleX (spring.soft) 45ms apart, the
 * count swaps, the open step swaps while the card springs to its height, rows slide to their place; the ready card
 * crossfades in place (opacity only, the card keeps its spot) */
function A(props: LabProps) {
  const { state, act, auto, replay } = useCard(props);
  const r = props.reduced;
  const current = STEPS[state.done];
  const scope = useId();
  return <Footer>
    <LayoutGroup id={scope}>
      <motion.aside layout={!r} transition={spring.height} style={{ borderRadius: 18 }} className={cn(CARD, state.finale && "flex flex-col items-center p-4 pt-5 text-center")}
        initial={{ opacity: 0, y: r ? 0 : 6, scale: r ? 1 : 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {state.finale
            ? <motion.div key="ready" className="flex flex-col items-center" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.25, delay: 0.08 } }}>
              <ReadyBody reduced={r} onDone={replay} motionKey={props.replayKey + 1} /></motion.div>
            : <motion.div key="setup" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              <Head done={state.done} reduced={r} />
              <div role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL} aria-valuenow={state.done} className="mt-3 flex gap-1">
                {STEPS.map((_, i) => <span key={i} className="relative h-1 flex-1 overflow-hidden rounded-full bg-ink-secondary/20">
                  <motion.span className="absolute inset-0 origin-left rounded-full bg-success" initial={{ scaleX: 0 }} animate={{ scaleX: i < state.done ? 1 : 0 }}
                    transition={r ? reducedFade : { ...spring.soft, delay: 0.1 + i * stagger.in }} />
                </span>)}
              </div>
              <Focus id={current?.id} reduced={r} onAct={act} />
              <Steps done={state.done} reduced={r} skip={current?.id} />
            </motion.div>}
        </AnimatePresence>
      </motion.aside>
    </LayoutGroup>
    <Again show={!auto} onClick={replay} />
  </Footer>;
}

/** B: progress is one continuous green bar that runs on 160/22; the count rolls;
 * the step that finishes slides down into the done list as the next opens (12px rise); the last tick morphs the whole
 * card into the ready card (height on spring.soft) while the mascot celebrates */
function B(props: LabProps) {
  const { state, act, auto, replay } = useCard(props);
  const r = props.reduced;
  const current = STEPS[state.done];
  const scope = useId();
  return <Footer>
    <LayoutGroup id={scope}>
      <motion.aside layout={!r} transition={spring.soft} style={{ borderRadius: 18 }} className={cn(CARD, state.finale && "flex flex-col items-center p-4 pt-5 text-center")}
        initial={{ opacity: 0, y: r ? 0 : 10, scale: r ? 1 : 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {state.finale
            ? <motion.div key="ready" className="flex flex-col items-center"
              initial={{ opacity: 0, y: r ? 0 : offset.rise, filter: r ? "none" : "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={r ? reducedFade : { ...spring.enter, delay: 0.1 }}>
              <ReadyBody reduced={r} onDone={replay} motionKey={props.replayKey + 1} /></motion.div>
            : <motion.div key="setup" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              <Head done={state.done} reduced={r} roll />
              <div role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL} aria-valuenow={state.done} className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-ink-secondary/20">
                <motion.span className="absolute inset-0 origin-left rounded-full bg-success" initial={{ scaleX: 0 }} animate={{ scaleX: state.done / TOTAL }}
                  transition={r ? reducedFade : { type: "spring", stiffness: 160, damping: 22, delay: 0.12 }} />
                {[1, 2, 3].map((i) => <span key={i} aria-hidden="true" className="absolute inset-y-0 w-[3px] bg-composer" style={{ left: `calc(${(i / TOTAL) * 100}% - 1.5px)` }} />)}
              </div>
              <Focus id={current?.id} reduced={r} onAct={act} rise={offset.rise} />
              <Steps done={state.done} reduced={r} skip={current?.id} />
            </motion.div>}
        </AnimatePresence>
      </motion.aside>
    </LayoutGroup>
    <Again show={!auto} onClick={replay} />
  </Footer>;
}

export const setupCard: Item = {
  id: "flows-cloud-setup-card",
  title: "cloud setup card -> ready",
  surface: "sidebar footer (CloudSetup, CloudReady)",
  height: 400,
  loopMs: 9000,
  notes: {
    original: "app classes: a filled segment clips open 550ms quint (+200ms, 90ms apart); a done mark lands with check-in (.85 -> 1.08 -> 1, 420ms) and its tick draws; the open step and every row re-rise 320ms on each change (animate-rise, 40ms stagger); the ready card replaces the setup card with pop-in.",
    a: "calm: only what changed moves: segments scaleX on spring.soft 45ms apart, count swaps 8px/blur, the open step swaps while the card springs to height (300/22), rows slide to place (spring.layout); checks pop (520/26) and draw; ready crossfades in the same card.",
    b: "alive: one continuous bar on 160/22 with notches, the count rolls, steps rise 12px; the card morphs its size into the ready card (spring.soft 260/24) which rises from blur on spring.enter while the mascot celebrates.",
  },
  Original, A, B,
};
