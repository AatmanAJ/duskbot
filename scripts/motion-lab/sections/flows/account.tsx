// the account step: Continue with Google -> finish in your browser (waiting for your browser) -> you're signed in -> Next.
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { ReactNode } from "react";
import { Art } from "@/components/ui/Art";
import { Check, LoaderCircle } from "@/icons";
import { PRIMARY, QUIET, TILE } from "@/components/onboarding/FunnelSteps";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ease, offset, reducedFade, spring, stagger } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { Again, Arc, Canvas, DrawCheck, Swap, useFlow } from "./kit/kit";

type Screen = "choose" | "opening" | "browser" | "signed";
const PROVIDERS = [["google", "funnel.account.google"], ["x", "funnel.account.x"]] as const;
const after: [number, Screen][] = [[700, "browser"], [2400, "signed"]];
const SCRIPT: [number, Screen][] = [[1300, "opening"], ...after];

function useAccount({ replayKey, speed }: LabProps) {
  const flow = useFlow<Screen>("choose", replayKey, speed, SCRIPT);
  return { ...flow, start: () => flow.run("opening", after), cancel: () => flow.go("choose"), next: () => flow.go("choose") };
}

function GoogleMark() {
  return <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>;
}
const MARK: Record<string, ReactNode> = { google: <GoogleMark />, x: <svg width={15} height={15} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /></svg> };
const BTN = cn(PRIMARY, "!w-[230px] ui-button-md");

function copy(screen: Screen) {
  if (screen === "signed") return { title: t("funnel.account.signedInTitle"), sub: t("funnel.account.signedIn", { email: "sam@example.com" }) };
  if (screen === "browser") return { title: t("funnel.account.browserTitle"), sub: t("funnel.account.browser") };
  return { title: t("funnel.account.title", { app: "dusk bot" }), sub: t("funnel.account.subNoPhone") };
}

/** today: the screen only changes once the browser has opened, so the press shows nothing until then; each screen is a new
 * StepFrame that slides in 12px (place-step), its art pops (place-mark) */
function Original(props: LabProps) {
  const { state, start, cancel, next, auto, replay } = useAccount(props);
  const screen = state === "opening" ? "choose" : state;
  const { title, sub } = copy(screen);
  return <Canvas>
    <div key={screen} data-from="forward" className="place-step flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 items-end">
        {screen === "signed"
          ? <span className="place-mark grid size-12 place-items-center rounded-full bg-success/10 text-success"><Check size={22} aria-hidden="true" /></span>
          : <Art name="key" size="lg" className="place-mark h-12" />}
      </div>
      <h3 className="text-balance text-[21px] leading-[26px] tracking-[-0.02em]">{title}</h3>
      <p className="mt-1.5 max-w-[290px] text-pretty text-[13px] leading-[18px] text-ink-secondary">{sub}</p>
      <div className="mt-5 flex w-full flex-col items-center gap-2">
        {screen === "choose" && PROVIDERS.map(([id, label]) => <button key={id} type="button" onClick={start} disabled={state === "opening"}
          className={cn(TILE, "flex min-h-11 w-[230px] items-center justify-center gap-2.5 text-[14px] disabled:opacity-50")}>{MARK[id]}{t(label)}</button>)}
        {screen === "browser" && <>
          <p role="status" className="flex items-center gap-2 text-[13px] leading-[18px] text-ink-secondary"><LoaderCircle size={14} aria-hidden="true" className="animate-spin" />{t("funnel.account.waiting")}</p>
          <button type="button" className={QUIET} onClick={cancel}>{t("funnel.cancel")}</button>
        </>}
        {screen === "signed" && <button type="button" onClick={next} className={BTN}>{t("funnel.next")}</button>}
      </div>
    </div>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

/** A: one page that changes in place. the art stays and crossfades; title and line swap (8px rise, 4px blur); the pressed
 * button answers at once (its icon becomes an arc, "Opening Google…"), the other one fades; signed in draws its check */
function A(props: LabProps) {
  const { state, start, cancel, next, auto, replay } = useAccount(props);
  const { title, sub } = copy(state === "opening" ? "choose" : state);
  const r = props.reduced;
  return <Canvas>
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 grid h-14 place-items-end">
        <AnimatePresence mode="popLayout" initial={false}>
          {state === "signed"
            ? <motion.span key="ok" className="grid size-12 place-items-center rounded-full bg-success/10 text-success"
              initial={{ opacity: 0, scale: r ? 1 : 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={r ? reducedFade : spring.pop}>
              <DrawCheck size={22} reduced={r} strokeWidth={2.2} /></motion.span>
            : <motion.span key="key" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}><Art name="key" size="lg" className="h-12" /></motion.span>}
        </AnimatePresence>
      </div>
      <Swap id={title} reduced={r} className="text-balance text-[21px] leading-[26px] tracking-[-0.02em]"><h3 className="whitespace-normal">{title}</h3></Swap>
      <Swap id={sub} reduced={r} className="mt-1.5 max-w-[290px] text-[13px] leading-[18px] text-ink-secondary"><p className="whitespace-normal text-pretty">{sub}</p></Swap>
      <motion.div layout={!r} transition={spring.height} className="mt-5 flex w-full flex-col items-center gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {(state === "choose" || state === "opening") && PROVIDERS.map(([id, label], i) => {
            const pressed = id === "google" && state === "opening";
            return <motion.button key={id} type="button" onClick={start} disabled={state === "opening"} aria-busy={pressed || undefined}
              animate={{ opacity: state === "opening" && !pressed ? 0.4 : 1 }} exit={{ opacity: 0, transition: { duration: 0.12, delay: i * stagger.out } }}
              className={cn(TILE, "flex min-h-11 w-[230px] items-center justify-center text-[14px] disabled:cursor-progress")}>
              <Swap id={pressed ? "busy" : "idle"} reduced={r}>
                {pressed ? <><Arc size={14} reduced={r} />Opening Google…</> : <span className="flex items-center gap-2.5">{MARK[id]}{t(label)}</span>}
              </Swap>
            </motion.button>;
          })}
          {state === "browser" && <motion.div key="wait" className="flex flex-col items-center gap-2"
            initial={{ opacity: 0, y: r ? 0 : offset.swapIn }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={r ? reducedFade : { ...spring.fade, delay: 0.08 }}>
            <p role="status" className="flex items-center gap-2 text-[13px] leading-[18px] text-ink-secondary"><Arc size={14} reduced={r} />{t("funnel.account.waiting")}</p>
            <button type="button" className={QUIET} onClick={cancel}>{t("funnel.cancel")}</button>
          </motion.div>}
          {state === "signed" && <motion.button key="next" type="button" onClick={next} className={BTN}
            initial={{ opacity: 0, y: r ? 0 : offset.swapIn }} animate={{ opacity: 1, y: 0 }} transition={r ? reducedFade : { ...spring.fade, delay: 0.25 }}>{t("funnel.next")}</motion.button>}
        </AnimatePresence>
      </motion.div>
    </div>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

/** B: the pressed button becomes the waiting pill (one shared element: it shrinks into a pill with an arc on spring.width,
 * the other button drops away); when the browser comes back the pill turns green, draws its check, and the Next button
 * rises in under it */
function B(props: LabProps) {
  const { state, start, cancel, next, auto, replay } = useAccount(props);
  const { title, sub } = copy(state === "opening" ? "choose" : state);
  const r = props.reduced;
  const morph = r ? { duration: 0 } : spring.width;
  const choosing = state === "choose";
  return <Canvas>
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 grid h-14 place-items-end">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={state === "signed" ? "ok" : "key"} initial={{ opacity: 0, y: r ? 0 : 6, scale: r ? 1 : 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={r ? reducedFade : spring.pop}>
            {state === "signed" ? <SignedMark /> : <Art name="key" size="lg" className="h-12" />}
          </motion.span>
        </AnimatePresence>
      </div>
      <Swap id={title} reduced={r} rise={offset.rise} className="text-balance text-[21px] leading-[26px] tracking-[-0.02em]"><h3 className="whitespace-normal">{title}</h3></Swap>
      <Swap id={sub} reduced={r} rise={offset.rise} className="mt-1.5 max-w-[290px] text-[13px] leading-[18px] text-ink-secondary"><p className="whitespace-normal text-pretty">{sub}</p></Swap>
      <LayoutGroup>
        <div className="mt-5 flex min-h-[100px] w-full flex-col items-center gap-2">
          <motion.button layoutId="pill" type="button" transition={morph} onClick={choosing ? start : state === "signed" ? undefined : cancel}
            aria-label={choosing ? undefined : state === "signed" ? t("funnel.account.signedInTitle") : `${t("funnel.account.waiting")}, ${t("funnel.cancel")}`}
            className={cn("flex min-h-11 items-center justify-center overflow-hidden rounded-full text-[14px] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              choosing ? "w-[230px] bg-ink/[0.035] hover:bg-ink/[0.06]" : state === "signed" ? "bg-success/12 px-4 text-success" : "bg-ink/[0.06] px-4 text-ink-secondary")}>
            <Swap id={state} reduced={r}>
              {choosing && <span className="flex items-center gap-2.5 text-ink"><GoogleMark />{t("funnel.account.google")}</span>}
              {(state === "opening" || state === "browser") && <><Arc size={14} reduced={r} />{state === "opening" ? "Opening Google…" : t("funnel.account.waiting")}</>}
              {state === "signed" && <><DrawCheck size={15} reduced={r} />sam@example.com</>}
            </Swap>
          </motion.button>
          <AnimatePresence initial={false}>
            {choosing && <motion.button key="x" type="button" onClick={start} className={cn(TILE, "flex min-h-11 w-[230px] items-center justify-center gap-2.5 text-[14px]")}
              initial={{ opacity: 0, y: r ? 0 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: r ? 0 : 6, transition: { duration: 0.12, ease: ease.out } }}>
              {MARK.x}{t("funnel.account.x")}</motion.button>}
            {state === "browser" && <motion.button key="cancel" type="button" className={QUIET} onClick={cancel}
              initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.2 } }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>{t("funnel.cancel")}</motion.button>}
            {state === "signed" && <motion.button key="next" type="button" onClick={next} className={BTN}
              initial={{ opacity: 0, y: r ? 0 : offset.rise, filter: r ? "none" : "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={r ? reducedFade : { ...spring.enter, delay: 0.32 }}>{t("funnel.next")}</motion.button>}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </div>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

function SignedMark() {
  return <span className="grid size-12 place-items-center rounded-full bg-success/10 text-success"><Check size={22} aria-hidden="true" /></span>;
}

export const account: Item = {
  id: "flows-account-step",
  title: "account step",
  surface: "onboarding (AccountStep)",
  height: 330,
  loopMs: 6000,
  notes: {
    original: "today: a press changes nothing until the browser has opened; then a new StepFrame slides 12px in (220ms quint) with \"Waiting for your browser\" and a spinning loader; signed in slides in again with its check art popping (place-mark).",
    a: "calm: one page that changes in place: title and line swap (8px rise, 4px blur, spring.fade 420/32); the pressed button answers at once with an arc and \"Opening Google…\"; signed in pops a circle (spring.pop) and draws its check; Next rises +250ms.",
    b: "alive: the pressed button morphs into the waiting pill (shared layout, spring.width 380/24), the other drops away; on return the pill turns green and draws its check with the email; text swaps rise 12px; Next rises from blur on spring.enter +320ms.",
  },
  Original, A, B,
};
