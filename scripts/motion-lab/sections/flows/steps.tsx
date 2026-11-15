// onboarding steps: welcome -> where bots live -> account -> connect an AI, with Back and the progress dots.
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { MausAvatar } from "@/components/Avatar";
import { PlaceArt, type PlaceArtName } from "@/components/ui/PlaceArt";
import { Art } from "@/components/ui/Art";
import { ChevronLeft } from "@/icons";
import { BRAND_LILAC, PRIMARY, TILE } from "@/components/onboarding/FunnelSteps";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ease, offset, reducedFade, spring, stagger } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { Again, Canvas, Stretch, useFlow } from "./kit/kit";

type At = { at: number; from: "forward" | "back" };
const COUNT = 4;
const SCRIPT = [[1500, { at: 1, from: "forward" }], [1700, { at: 2, from: "forward" }], [1700, { at: 3, from: "forward" }], [1700, { at: 2, from: "back" }]] as const;

function useSteps({ replayKey, speed }: LabProps) {
  const flow = useFlow<At>({ at: 0, from: "forward" }, replayKey, speed, SCRIPT as never);
  const next = () => flow.go((now) => ({ at: (now.at + 1) % COUNT, from: now.at + 1 >= COUNT ? "back" : "forward" }));
  const back = () => flow.go((now) => ({ at: Math.max(0, now.at - 1), from: "back" }));
  return { ...flow, next, back };
}

const BUTTON = cn(PRIMARY, "!w-[220px] ui-button-md");

/** one step's content, compact so a column holds it; pieces are returned separately so a variant can stagger them */
function stepParts(at: number, reduced: boolean, onNext: () => void, artClass?: string): { art: ReactNode; title: string; sub: string; body: ReactNode } {
  const device = "Mac";
  switch (at) {
    case 0: return {
      art: <MausAvatar color="purple" gradient={BRAND_LILAC} size={56} state="excited" animated={!reduced} label="dusk bot" />,
      title: t("funnel.welcome.title", { app: "dusk bot" }), sub: t("funnel.welcome.sub"),
      body: <button type="button" onClick={onNext} className={BUTTON}>{t("funnel.welcome.start")}</button>,
    };
    case 1: return {
      art: <MausAvatar color="purple" gradient={BRAND_LILAC} size={44} state="excited" animated={!reduced} label="dusk bot" />,
      title: t("funnel.place.title"), sub: t("funnel.place.mac", { device }) + " or dusk cloud",
      body: <div className="grid w-full grid-cols-2 gap-2">
        {([["mac", t("funnel.place.mac", { device }), t("funnel.place.macTag")], ["cloud", t("funnel.place.cloud"), "7 days free"]] as const).map(([art, title, tag]) =>
          <button key={art} type="button" onClick={onNext} className={cn(TILE, "flex flex-col items-start gap-2 p-3 text-start")}>
            <span className="flex w-full items-start justify-between"><PlaceArt name={art as PlaceArtName} size={30} /><span className="rounded-full bg-ink/[0.06] px-1.5 text-[11px] leading-4 text-ink-secondary">{tag}</span></span>
            <span className="text-[13px] font-semibold leading-4">{title}</span>
          </button>)}
      </div>,
    };
    case 2: return {
      art: <Art name="key" size="lg" className={cn("h-12", artClass)} />,
      title: t("funnel.account.title", { app: "dusk bot" }), sub: t("funnel.account.subNoPhone"),
      body: <button type="button" onClick={onNext} className={cn(TILE, "flex min-h-11 w-[220px] items-center justify-center text-[14px]")}>{t("funnel.account.google")}</button>,
    };
    default: return {
      art: <Art name="key" size="lg" className={cn("h-12 opacity-0", artClass)} />,
      title: t("funnel.ai.title"), sub: t("funnel.ai.sub"),
      body: <div className="grid w-full grid-cols-4 gap-1.5">
        {["ChatGPT", "Claude", "Gemini", "Grok"].map((name) => <button key={name} type="button" onClick={onNext} className={cn(TILE, "h-12 text-[12px]")}>{name}</button>)}
      </div>,
    };
  }
}

function BackButton({ onBack }: { onBack: () => void }) {
  return <button type="button" onClick={onBack}
    className="pointer-events-auto absolute start-2 inline-flex min-h-11 items-center gap-0.5 rounded-full py-1 pe-3 ps-1.5 text-[12px] leading-[18px] text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
    <ChevronLeft size={15} strokeWidth={1.5} aria-hidden="true" />{t("funnel.back")}
  </button>;
}

function Progress({ at, children }: { at: number; children: ReactNode }) {
  return <div role="progressbar" aria-label={t("funnel.progress")} aria-valuemin={1} aria-valuemax={COUNT} aria-valuenow={at + 1} className="relative flex items-center gap-1.5">{children}</div>;
}

function Original(props: LabProps) {
  const { state, next, back, auto, replay } = useSteps(props);
  const parts = stepParts(state.at, props.reduced, next, "place-mark");
  return <Canvas>
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-12 items-center justify-center">
      {state.at > 0 && <BackButton onBack={back} />}
      {state.at > 0 && <Progress at={state.at}>
        {Array.from({ length: COUNT }, (_, index) => <span key={index} aria-hidden="true"
          className={cn("h-1 rounded-full transition-[width,background-color] duration-300 ease-[var(--dusk-ease-quint)] motion-reduce:transition-none",
            index === state.at ? "w-6 bg-ink" : index < state.at ? "w-3 bg-ink/45" : "w-3 bg-ink/12")} />)}
      </Progress>}
    </div>
    <div key={state.at} data-from={state.from} className="place-step flex h-full flex-col items-center justify-center px-6 pt-8 text-center">
      <div className="mb-4 flex h-14 items-end">{parts.art}</div>
      <h3 className="text-balance text-[21px] leading-[26px] tracking-[-0.02em]">{parts.title}</h3>
      <p className="mt-1.5 max-w-[300px] text-pretty text-[13px] leading-[18px] text-ink-secondary">{parts.sub}</p>
      <div className="mt-5 flex w-full flex-col items-center">{parts.body}</div>
    </div>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

/** A: the page moves as one, 16px toward where it was reached from on 250ms ease.out; the old one leaves faster (120ms, no
 * travel back); the dots' width runs on spring.width */
function A(props: LabProps) {
  const { state, next, back, auto, replay } = useSteps(props);
  const parts = stepParts(state.at, props.reduced, next);
  const dir = state.from === "forward" ? 1 : -1;
  return <Canvas>
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-12 items-center justify-center">
      <AnimatePresence initial={false}>{state.at > 0 && <motion.div key="back" className="absolute inset-0 flex items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}><BackButton onBack={back} /></motion.div>}</AnimatePresence>
      <motion.div animate={{ opacity: state.at > 0 ? 1 : 0 }} transition={{ duration: 0.2, ease: ease.out }}>
        <Progress at={state.at}>
          {Array.from({ length: COUNT }, (_, index) => <motion.span key={index} aria-hidden="true" className="h-1 rounded-full"
            initial={false} animate={{ width: index === state.at ? 24 : 12, backgroundColor: index === state.at ? "var(--color-ink)" : index < state.at ? "color-mix(in srgb, var(--color-ink) 45%, transparent)" : "color-mix(in srgb, var(--color-ink) 12%, transparent)" }}
            transition={props.reduced ? reducedFade : { width: spring.width, backgroundColor: { duration: 0.2 } }} />)}
        </Progress>
      </motion.div>
    </div>
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.div key={state.at} custom={dir} className="absolute inset-0 flex flex-col items-center justify-center px-6 pt-8 text-center"
        variants={{
          enter: (d: number) => (props.reduced ? { opacity: 0 } : { opacity: 0, x: 16 * d }),
          show: { opacity: 1, x: 0, transition: props.reduced ? reducedFade : { duration: 0.25, ease: ease.out } },
          leave: { opacity: 0, transition: { duration: 0.12, ease: ease.out } },
        }}
        initial="enter" animate="show" exit="leave">
        <div className="mb-4 flex h-14 items-end">{parts.art}</div>
        <h3 className="text-balance text-[21px] leading-[26px] tracking-[-0.02em]">{parts.title}</h3>
        <p className="mt-1.5 max-w-[300px] text-pretty text-[13px] leading-[18px] text-ink-secondary">{parts.sub}</p>
        <div className="mt-5 flex w-full flex-col items-center">{parts.body}</div>
      </motion.div>
    </AnimatePresence>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

/** B: the progress is one ink pill that stretches between dots (front edge 620/36, back edge 190/19); the new page arrives
 * in a 45ms cascade (art, title, line, action), each rising 12px out of a 4px blur on spring.enter; the old page just fades */
function B(props: LabProps) {
  const { state, next, back, auto, replay } = useSteps(props);
  const parts = stepParts(state.at, props.reduced, next);
  const dir = state.from === "forward" ? 1 : -1;
  const DOT = 12, GAP = 6, WIDE = 24;
  const left = state.at * (DOT + GAP);
  const right = left + WIDE;
  const rise = (i: number) => ({
    hidden: props.reduced ? { opacity: 0 } : { opacity: 0, y: offset.rise, filter: `blur(${offset.blurIn}px)` },
    show: { opacity: 1, y: 0, filter: "blur(0px)", transition: props.reduced ? reducedFade : { ...spring.enter, delay: 0.06 + i * stagger.in } },
  });
  return <Canvas>
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-12 items-center justify-center">
      <AnimatePresence initial={false}>{state.at > 0 && <motion.div key="back" className="absolute inset-0 flex items-center" initial={{ opacity: 0, x: props.reduced ? 0 : -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={spring.fade}><BackButton onBack={back} /></motion.div>}</AnimatePresence>
      <motion.div animate={{ opacity: state.at > 0 ? 1 : 0 }} transition={{ duration: 0.2, ease: ease.out }}>
        <Progress at={state.at}>
          {Array.from({ length: COUNT }, (_, index) => <span key={index} aria-hidden="true" className="h-1 rounded-full bg-ink/12" style={{ width: index === state.at ? WIDE : DOT }} />)}
          <motion.span aria-hidden="true" className="absolute start-0 top-0 h-1 rounded-full bg-ink/45" initial={false}
            animate={{ width: Math.max(0, left - GAP) }} transition={props.reduced ? { duration: 0 } : spring.soft} />
          <Stretch left={left} right={right} reduced={props.reduced} className="top-0 h-1 rounded-full bg-ink" />
        </Progress>
      </motion.div>
    </div>
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.div key={state.at} className="absolute inset-0 flex flex-col items-center justify-center px-6 pt-8 text-center"
        initial="hidden" animate="show" exit={{ opacity: 0, transition: { duration: 0.12, ease: ease.out } }}>
        <motion.div variants={{
          hidden: props.reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 6 },
          show: { opacity: 1, scale: 1, y: 0, transition: props.reduced ? reducedFade : spring.pop },
        }} className="mb-4 flex h-14 items-end">{parts.art}</motion.div>
        <motion.h3 variants={rise(1)} className="text-balance text-[21px] leading-[26px] tracking-[-0.02em]">{parts.title}</motion.h3>
        <motion.p variants={rise(2)} className="mt-1.5 max-w-[300px] text-pretty text-[13px] leading-[18px] text-ink-secondary">{parts.sub}</motion.p>
        <motion.div variants={rise(3)} className="mt-5 flex w-full flex-col items-center">{parts.body}</motion.div>
      </motion.div>
    </AnimatePresence>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

export const steps: Item = {
  id: "flows-onboarding-steps",
  title: "onboarding steps",
  surface: "onboarding (WelcomeFlow, FunnelSteps)",
  height: 340,
  loopMs: 9000,
  notes: {
    original: "today: each step slides 12px in from its side, 220ms quint (place-step); the art pops from .88 on the css spring (place-mark); dots change width and colour in 300ms quint. Click the buttons or Back.",
    a: "calm: the page moves as one, 16px from its side on 250ms ease.out, the old page fades out in 120ms (no travel back); dots' width on spring.width 380/24. Directional step pattern (Family idea, rebuilt).",
    b: "alive: one stretchy ink pill for progress (front edge 620/36, back 190/19, rebuilt from DesignBookmark pagination dots, look only); the page cascades in 45ms apart, art on spring.pop 520/26, text rising 12px from 4px blur on spring.enter 300/22.",
  },
  Original, A, B,
};
