// the update pill in the sidebar footer: Update to 1.42 -> Downloading 1.42 n% -> Restart to update -> restarting.
// Original is the real AppUpdatePill on a fake bridge.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ArrowDownToLine, RefreshCw } from "lucide-react";
import type { AppUpdateBridge, AppUpdateState } from "../../../../electron/app-update.mjs";
import { AppUpdatePill } from "@/components/AppUpdatePill";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ease, reducedFade, spring } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { Again, Canvas, Roll, Swap, useFlow } from "./kit/kit";

const VERSION = "1.42.0";
type U = { phase: "available" | "downloading" | "ready" | "restarting"; p: number };
const START: U = { phase: "available", p: 0 };
/** a real download's pace: quick to a third, a stall, then a run home */
const PACE = [0.06, 0.14, 0.23, 0.31, 0.36, 0.38, 0.4, 0.47, 0.58, 0.69, 0.8, 0.9, 0.97, 1];
const download: [number, (u: U) => U][] = [
  ...PACE.map((p) => [300, () => ({ phase: "downloading", p })] as [number, (u: U) => U]),
  [300, () => ({ phase: "ready", p: 1 })],
];
const restart: [number, (u: U) => U][] = [[1600, () => START]];
const SCRIPT: [number, (u: U) => U][] = [[900, () => ({ phase: "downloading", p: 0 })], ...download, [1300, () => ({ phase: "restarting", p: 1 })], ...restart];

function useUpdate(props: LabProps) {
  const flow = useFlow<U>(START, props.replayKey, props.speed, SCRIPT);
  const click = () => {
    if (flow.state.phase === "available") flow.run({ phase: "downloading", p: 0 }, download);
    else if (flow.state.phase === "ready") flow.run({ phase: "restarting", p: 1 }, restart);
  };
  return { ...flow, click };
}

/** the sidebar footer the pill sits in */
function Footer({ children }: { children: ReactNode }) {
  return <Canvas className="items-center justify-center">
    <div className="flex w-[300px] max-w-full flex-col gap-2 rounded-2xl bg-ink/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 whitespace-nowrap text-[12.5px] text-ink-secondary">dusk bot</span>
        {children}
      </div>
      <div className="h-8 rounded-lg bg-ink/[0.04]" />
    </div>
  </Canvas>;
}

function Original(props: LabProps) {
  const { state, click, auto, replay } = useUpdate(props);
  const listeners = useRef(new Set<(s: AppUpdateState) => void>());
  const current = useRef<AppUpdateState>({ ready: null, available: VERSION, progress: null });
  const next: AppUpdateState = state.phase === "ready" || state.phase === "restarting" ? { ready: VERSION, available: VERSION, progress: null }
    : state.phase === "downloading" ? { ready: null, available: VERSION, progress: state.p } : { ready: null, available: VERSION, progress: null };
  current.current = next;
  useEffect(() => { for (const listener of listeners.current) listener(current.current); }, [state.phase, state.p]);
  const clickRef = useRef(click);
  clickRef.current = click;
  const bridge = useMemo<AppUpdateBridge>(() => ({
    state: async () => current.current,
    download: async () => { clickRef.current(); return VERSION; },
    restart: async () => { clickRef.current(); return true; },
    onState: (cb) => { listeners.current.add(cb); return () => listeners.current.delete(cb); },
  }), []);
  // the real pill holds "restarting" until the app goes away, so a fresh one stands in once the flow starts over
  const rounds = useRef({ count: 0, last: state.phase });
  if (rounds.current.last !== state.phase) {
    if (state.phase === "available") rounds.current.count += 1;
    rounds.current.last = state.phase;
  }
  return <Footer><AppUpdatePill key={`${props.replayKey}-${rounds.current.count}`} bridge={bridge} /><Again show={!auto} onClick={replay} /></Footer>;
}

const PILL = "relative isolate flex items-center gap-1.5 overflow-hidden rounded-full px-3 py-[5px] text-[12.5px] leading-4 transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";
const BG = "bg-[light-dark(color-mix(in_srgb,var(--color-raised),white_25%),color-mix(in_srgb,var(--color-raised),white_3%))] text-ink hover:bg-[color-mix(in_srgb,var(--color-raised),var(--color-ink)_6%)]";
const label = (u: U) => (u.phase === "available" ? t("appUpdate.available", { version: VERSION }) : u.phase === "downloading" ? t("appUpdate.downloading", { version: VERSION }) : t("appUpdate.restart"));

/** A: width follows the words on spring.width; icon and label swap (8px rise, 4px blur); the percent rolls only the digits
 * that change; the fill runs linear 300ms (a clock) and fades out at ready; restart turns the icon */
function A(props: LabProps) {
  const { state, click, auto, replay } = useUpdate(props);
  const r = props.reduced;
  const ready = state.phase === "ready" || state.phase === "restarting";
  return <Footer>
    <motion.button layout={!r} transition={spring.width} style={{ borderRadius: 999 }} type="button" onClick={click}
      aria-busy={state.phase === "downloading" || state.phase === "restarting" || undefined} className={cn(PILL, BG)}>
      <AnimatePresence>
        {state.phase === "downloading" && <motion.span key="fill" aria-hidden="true" className="absolute inset-0 -z-10 origin-left bg-[color-mix(in_srgb,var(--color-raised),var(--color-ink)_8%)]"
          initial={{ scaleX: 0, opacity: 1 }} animate={{ scaleX: state.p }} exit={{ opacity: 0, transition: { duration: 0.2 } }} transition={{ duration: 0.3, ease: ease.linear }} />}
      </AnimatePresence>
      <Swap id={ready ? "r" : "d"} reduced={r}>
        {ready ? <RefreshCw size={13} aria-hidden="true" className={state.phase === "restarting" && !r ? "flows-turn" : undefined} /> : <ArrowDownToLine size={13} aria-hidden="true" />}
      </Swap>
      <Swap id={label(state)} reduced={r}>{label(state)}</Swap>
      {state.phase === "downloading" && <motion.span layout="position" className="text-ink-secondary" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Roll value={`${Math.round(state.p * 100)}%`} reduced={r} stagger={0} />
      </motion.span>}
    </motion.button>
    <Again show={!auto} onClick={replay} />
  </Footer>;
}

/** B: the progress is a ring that fills around the download arrow (follows on 160/22) while digits roll 45ms apart; at ready
 * the pill fills ink on the pop spring with "Restart to update" rising out of blur, and the icon turns once into place */
function B(props: LabProps) {
  const { state, click, auto, replay } = useUpdate(props);
  const r = props.reduced;
  const ready = state.phase === "ready" || state.phase === "restarting";
  const C = 2 * Math.PI * 7;
  return <Footer>
    <motion.button layout={!r} style={{ borderRadius: 999 }} type="button" onClick={click}
      aria-busy={state.phase === "downloading" || state.phase === "restarting" || undefined}
      className={cn(PILL, ready ? "bg-ink text-app" : BG)}
      initial={false} animate={{ scale: ready && !r ? [1, 1.04, 1] : 1 }} transition={{ scale: { duration: 0.32, ease: ease.out }, layout: spring.width }}>
      <span className="relative grid size-4 place-items-center">
        <Swap id={ready ? "r" : "d"} reduced={r}>
          {ready
            ? <motion.span initial={{ rotate: r ? 0 : -120 }} animate={{ rotate: 0 }} transition={r ? reducedFade : spring.settle} className={state.phase === "restarting" && !r ? "flows-turn" : undefined}>
              <RefreshCw size={13} aria-hidden="true" /></motion.span>
            : <ArrowDownToLine size={state.phase === "downloading" ? 10 : 13} aria-hidden="true" />}
        </Swap>
        {state.phase === "downloading" && <svg aria-hidden="true" viewBox="0 0 16 16" className="absolute inset-0 -rotate-90">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="1.5" />
          <motion.circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={C}
            initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - state.p) }} transition={r ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 22 }} />
        </svg>}
      </span>
      <Swap id={label(state)} reduced={r} rise={12}>{label(state)}</Swap>
      {state.phase === "downloading" && <motion.span layout="position" className="text-ink-secondary" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Roll value={`${Math.round(state.p * 100)}%`} reduced={r} />
      </motion.span>}
    </motion.button>
    <Again show={!auto} onClick={replay} />
  </Footer>;
}

export const update: Item = {
  id: "flows-update-pill",
  title: "update pill",
  surface: "sidebar footer (AppUpdatePill)",
  height: 220,
  loopMs: 8000,
  notes: {
    original: "real AppUpdatePill on a fake bridge: label and icon change instantly; the fill grows with scaleX in 300ms ease-out under the words; the percent text just changes; Restart spins the icon. Click it.",
    a: "calm: width follows the words on spring.width 380/24; icon and label swap 8px/blur 4; percent rolls only changed digits (drums 260/22); fill linear 300ms (a clock), fades at ready; restart turns the icon.",
    b: "alive: a ring fills around the arrow (160/22) while digits roll 45ms apart; at ready the pill fills ink with a small 1.04 swell (320ms ease.out), \"Restart to update\" rises 12px from blur and the icon turns into place (spring.settle 280/22).",
  },
  Original, A, B,
};
