// connect an AI: pick a provider card -> getting it ready -> its sign-in opens -> waiting for your browser -> checking
// -> connected. Original drives the real Reveal, StageSwap and ConnectPanel with a fake flow handle.
import { AnimatePresence, motion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { Check, ExternalLink } from "@/icons";
import { PresetProviderMark, ProviderMark } from "@/components/ProviderIcons";
import { Reveal, StageSwap } from "@/components/onboarding/ConnectMotion";
import { ConnectPanel, type ConnectFlowHandle } from "@/components/onboarding/SignInPill";
import type { ConnectState } from "@/components/onboarding/connect-flow";
import { TILE } from "@/components/onboarding/FunnelSteps";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { ease, offset, reducedFade, spring, timing } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { Again, Arc, Canvas, DrawCheck, Swap, useFlow } from "./kit/kit";

type Tile = { id: string; label: string; driver: string; mark: (size: number) => ReactNode };
const TILES: Tile[] = [
  { id: "chatgpt", label: "ChatGPT", driver: "codex", mark: (s) => <ProviderMark driverKind="codex" size={s} /> },
  { id: "claude", label: "Claude", driver: "claudeAgent", mark: (s) => <ProviderMark driverKind="claudeAgent" size={s} /> },
  { id: "gemini", label: "Gemini", driver: "geminiAgent", mark: (s) => <PresetProviderMark preset="google" size={s} /> },
  { id: "grok", label: "Grok", driver: "grokAgent", mark: (s) => <ProviderMark driverKind="grokAgent" size={s} /> },
];
const SITE: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Google", grok: "Grok" };

type Stage = "idle" | "preparing" | "opening" | "waiting" | "confirming" | "connected";
type S = { picked: string | null; stage: Stage; done: string[] };
const IDLE: S = { picked: null, stage: "idle", done: [] };

/** the waits a real connect takes, shortened: ready, open, the person in their browser, checking, connected, the panel folds */
const after = (id: string): [number, (s: S) => S][] => [
  [1000, (s) => ({ ...s, stage: "opening" })],
  [800, (s) => ({ ...s, stage: "waiting" })],
  [2600, (s) => ({ ...s, stage: "confirming" })],
  [900, (s) => ({ ...s, stage: "connected" })],
  [900, (s) => ({ ...s, picked: null, stage: "idle", done: [...s.done, id] })],
];
const SCRIPT: [number, (s: S) => S][] = [[900, (s) => ({ ...s, picked: "claude", stage: "preparing" })], ...after("claude")];

function useConnect({ replayKey, speed }: LabProps) {
  const flow = useFlow<S>(IDLE, replayKey, speed, SCRIPT);
  const pick = (id: string) => {
    if (flow.state.done.includes(id)) return;
    if (flow.state.picked === id) return flow.go((s) => ({ ...s, picked: null, stage: "idle" }));
    flow.run((s) => ({ ...s, picked: id, stage: "preparing" }), after(id));
  };
  const cancel = () => flow.go((s) => ({ ...s, picked: null, stage: "idle" }));
  return { ...flow, pick, cancel };
}

function realState(stage: Stage, id: string): ConnectState {
  const since = Date.now();
  switch (stage) {
    case "idle": return { stage: "idle" };
    case "waiting": return { stage: "waiting", since, kind: "browser" as never, flowId: "lab", link: `https://${id}.example/login`, code: null, opened: true };
    case "connected": return { stage: "connected", reused: false };
    default: return { stage, since };
  }
}

/** the real grid's card, as AiCards draws it (picked and connected looks) */
function RealCard({ tile, picked, connected, onPick }: { tile: Tile; picked: boolean; connected: boolean; onPick: () => void }) {
  if (connected) return <div role="listitem" className="ai-connected place-reveal relative flex h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-ink/[0.035] px-2">
    <span className="grid size-7 place-items-center">{tile.mark(24)}</span>
    <span className="flex max-w-full flex-col items-center">
      <span className="max-w-full truncate text-[12px] leading-4 text-ink">{tile.label}</span>
      <span className="connect-label-in flex items-center gap-1 text-[11px] leading-4 text-success"><Check size={11} strokeWidth={2.5} aria-hidden="true" />{t("funnel.ai.ready")}</span>
    </span>
  </div>;
  return <div role="listitem" className="flex">
    <button type="button" aria-pressed={picked} onClick={onPick}
      className={cn(TILE, "relative flex h-[84px] w-full flex-col items-center justify-center gap-2 px-2", picked && "bg-ink/[0.08] hover:bg-ink/[0.08]")}>
      <span className="grid size-7 place-items-center">{tile.mark(24)}</span>
      <span className="max-w-full truncate text-[12px] leading-4 text-ink">{tile.label}</span>
    </button>
  </div>;
}

function Header() {
  return <div className="mb-4 text-center">
    <h3 className="text-[19px] leading-6 tracking-[-0.02em]">{t("funnel.ai.title")}</h3>
    <p className="mx-auto mt-1 max-w-[300px] text-[12px] leading-4 text-ink-secondary">{t("funnel.ai.sub")}</p>
  </div>;
}

function Original(props: LabProps) {
  const { state, pick, cancel, auto, replay } = useConnect(props);
  const chosen = TILES.find((tile) => tile.id === state.picked);
  const handle = useMemo<ConnectFlowHandle>(() => ({
    state: realState(state.stage, state.picked ?? "claude"), target: null,
    start: () => {}, cancel, retry: () => {}, openAgain: async () => true, submit: () => {},
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state.stage, state.picked]);
  return <Canvas className="px-5 pt-6">
    <Header />
    <div role="list" className="grid grid-cols-4 gap-2">
      {TILES.map((tile) => <RealCard key={tile.id} tile={tile} picked={state.picked === tile.id} connected={state.done.includes(tile.id)} onPick={() => pick(tile.id)} />)}
    </div>
    <Reveal className="pt-4">
      {chosen && <StageSwap stage={chosen.id}>
        <div className="flex w-full flex-col items-center text-[13px]">
          <ConnectPanel flow={handle} name={chosen.label} driverKind={chosen.driver} />
        </div>
      </StageSwap>}
    </Reveal>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

const QUIETBTN = "inline-flex min-h-8 items-center gap-1.5 rounded-full bg-ink/[0.06] px-3 text-[12px] leading-4 text-ink transition-colors hover:bg-ink/[0.1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function stageLine(stage: Stage, name: string): string {
  switch (stage) {
    case "preparing": return t("connect.stage.preparing", { name });
    case "opening": return t("connect.stage.opening", { name });
    case "waiting": return "Waiting for your browser";
    case "confirming": return t("connect.stage.confirming", { name });
    case "connected": return t("connect.stage.connected");
    default: return "";
  }
}

/** the card as the variants draw it: on connect its label rolls to a green Connected with a drawn check */
function Card({ tile, picked, connected, onPick, reduced, badge }: { tile: Tile; picked: boolean; connected: boolean; onPick: () => void; reduced: boolean; badge?: boolean }) {
  return <div role="listitem" className="flex">
    <button type="button" aria-pressed={picked} aria-disabled={connected || undefined} onClick={onPick}
      className={cn(TILE, "relative flex h-[84px] w-full flex-col items-center justify-center gap-2 px-2 transition-[background-color,transform] duration-200",
        picked && "bg-ink/[0.08] hover:bg-ink/[0.08]", connected && "cursor-default bg-success/[0.08] hover:bg-success/[0.08] active:scale-100")}>
      <span className="grid size-7 place-items-center">{tile.mark(24)}</span>
      <Swap id={connected ? "on" : "off"} reduced={reduced} className="text-[12px] leading-4">
        {connected ? <span className="flex items-center gap-1 text-success"><DrawCheck size={12} reduced={reduced} delay={0.12} />{t("funnel.ai.ready")}</span> : tile.label}
      </Swap>
      <AnimatePresence>
        {badge && connected && <motion.span aria-hidden="true" className="absolute end-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-success text-white"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={reduced ? reducedFade : spring.pop}>
          <DrawCheck size={10} strokeWidth={3.4} reduced={reduced} delay={0.1} draw={0.25} />
        </motion.span>}
      </AnimatePresence>
    </button>
  </div>;
}

/** the stage's own controls: waiting says what to do in the browser and offers Open again; every stage but checking can be left */
function StageBody({ stage, name, site, onCancel, reduced }: { stage: Stage; name: string; site: string; onCancel: () => void; reduced: boolean }) {
  const busy = stage !== "connected";
  return <div className="flex flex-col items-center gap-2 text-center">
    <p role="status" className={cn("m-0 flex items-center gap-2 text-[13px] leading-[18px]", busy ? "text-ink" : "text-success")}>
      {busy ? <Arc size={13} reduced={reduced} /> : <DrawCheck size={14} reduced={reduced} />}
      {stageLine(stage, name)}
    </p>
    {stage === "waiting" && <p className="m-0 max-w-[300px] text-[11.5px] leading-4 text-ink-secondary">{t("connect.guide.browser", { site })}</p>}
    {busy && stage !== "confirming" && <div className="flex items-center gap-1.5">
      {stage === "waiting" && <button type="button" className={QUIETBTN}><ExternalLink size={12} aria-hidden="true" />{t("connect.openAgain")}</button>}
      <button type="button" onClick={onCancel} className={QUIETBTN}>{t("common.cancel")}</button>
    </div>}
  </div>;
}

/** A: the panel's height springs open (spring.height 300/22) and its content follows 80ms later; each stage swaps by
 * rising 8px out of a 4px blur while the box eases to the new height; Connected draws its check, the card's label rolls to
 * Connected, then the panel folds (240ms) */
function A(props: LabProps) {
  const { state, pick, cancel, auto, replay } = useConnect(props);
  const chosen = TILES.find((tile) => tile.id === state.picked);
  const open = Boolean(chosen);
  return <Canvas className="px-5 pt-6">
    <Header />
    <div role="list" className="grid grid-cols-4 gap-2">
      {TILES.map((tile) => <Card key={tile.id} tile={tile} picked={state.picked === tile.id} connected={state.done.includes(tile.id)} onPick={() => pick(tile.id)} reduced={props.reduced} />)}
    </div>
    <AnimatePresence initial={false}>
      {open && chosen && <motion.div key="panel" className="overflow-hidden"
        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0, transition: props.reduced ? reducedFade : { height: { duration: 0.24, ease: ease.out }, opacity: { duration: 0.14 } } }}
        transition={props.reduced ? reducedFade : { height: spring.height, opacity: { duration: 0.2, ease: ease.out } }}>
        <motion.div layout={!props.reduced} transition={spring.height} className="pt-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={state.stage}
              initial={props.reduced ? { opacity: 0 } : { opacity: 0, y: offset.swapIn, filter: `blur(${offset.blurIn}px)` }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: props.reduced ? reducedFade : { ...spring.fade, delay: timing.contentLag / 1000 } }}
              exit={{ opacity: 0, y: props.reduced ? 0 : offset.swapOut, filter: props.reduced ? "none" : `blur(${offset.blurOut}px)`, transition: { duration: 0.12, ease: ease.out } }}>
              <StageBody stage={state.stage} name={chosen.label} site={SITE[chosen.id]!} onCancel={cancel} reduced={props.reduced} />
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </motion.div>}
    </AnimatePresence>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

const RAIL: { key: string; label: string; stages: Stage[] }[] = [
  { key: "ready", label: "Get ready", stages: ["preparing", "opening"] },
  { key: "sign", label: "Sign in", stages: ["waiting"] },
  { key: "check", label: "Check", stages: ["confirming"] },
];

/** three steps on a rail: the line fills between dots (160/22), a done dot fills green (260/24) and its check draws +120ms */
function Rail({ stage, reduced }: { stage: Stage; reduced: boolean }) {
  const at = stage === "connected" ? RAIL.length : Math.max(0, RAIL.findIndex((step) => step.stages.includes(stage)));
  return <ol className="relative mx-auto grid w-[260px] grid-cols-3" aria-label="Sign-in steps">
    {RAIL.map((step, index) => {
      const done = index < at, now = index === at;
      return <li key={step.key} aria-current={now ? "step" : undefined} className="relative flex flex-col items-center gap-1.5">
        {index > 0 && <span aria-hidden="true" className="absolute end-[calc(50%+11px)] top-[8px] h-0.5 w-[calc(100%-22px)] overflow-hidden rounded-full bg-ink/10">
          <motion.span className="block h-full origin-left rounded-full bg-success" initial={false} animate={{ scaleX: index <= at ? 1 : 0 }}
            transition={reduced ? reducedFade : { type: "spring", stiffness: 160, damping: 22 }} />
        </span>}
        <motion.span aria-hidden="true" className="relative grid size-[18px] place-items-center rounded-full text-white" initial={false}
          animate={{ backgroundColor: done ? "var(--color-success)" : now ? "var(--color-ink)" : "color-mix(in srgb, var(--color-ink) 10%, transparent)", scale: now && !reduced ? 1.08 : 1 }}
          transition={reduced ? reducedFade : { type: "spring", stiffness: 260, damping: 24 }}>
          {done ? <DrawCheck key="c" size={11} strokeWidth={3.4} reduced={reduced} delay={0.12} draw={0.25} /> : now && <Arc size={11} reduced={reduced} className="text-app" />}
        </motion.span>
        <span className={cn("text-[11px] leading-4 transition-colors duration-200", done ? "text-ink-secondary" : now ? "text-ink" : "text-ink-tertiary")}>{step.label}</span>
      </li>;
    })}
  </ol>;
}

/** B: a tray that grows out of the pressed card (origin under it, .96 -> 1 with the height on spring.soft); a three-step
 * rail shows where the sign-in is; when connected the tray folds back up into the card, which tints green and pops a
 * check badge (spring.pop) */
function B(props: LabProps) {
  const { state, pick, cancel, auto, replay } = useConnect(props);
  const index = TILES.findIndex((tile) => tile.id === state.picked);
  const chosen = TILES[index];
  return <Canvas className="px-5 pt-6">
    <Header />
    <div role="list" className="grid grid-cols-4 gap-2">
      {TILES.map((tile) => <Card key={tile.id} tile={tile} picked={state.picked === tile.id} connected={state.done.includes(tile.id)} onPick={() => pick(tile.id)} reduced={props.reduced} badge />)}
    </div>
    <AnimatePresence initial={false}>
      {chosen && <motion.div key={chosen.id} className="overflow-hidden"
        style={{ transformOrigin: `${((index + 0.5) / TILES.length) * 100}% 0%` }}
        initial={props.reduced ? { opacity: 0 } : { height: 0, opacity: 0, scale: 0.96 }}
        animate={{ height: "auto", opacity: 1, scale: 1 }}
        exit={props.reduced ? { opacity: 0, transition: reducedFade } : { height: 0, opacity: 0, scale: 0.96, transition: { duration: 0.26, ease: ease.inOut } }}
        transition={props.reduced ? reducedFade : { height: spring.soft, scale: spring.soft, opacity: { duration: 0.18 } }}>
        <div className="pt-2.5">
          <div className="rounded-2xl bg-ink/[0.035] px-4 pb-3.5 pt-3.5">
            <Rail stage={state.stage} reduced={props.reduced} />
            <motion.div layout={!props.reduced} transition={spring.height} className="mt-3 flex flex-col items-center">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={state.stage}
                  initial={props.reduced ? { opacity: 0 } : { opacity: 0, y: offset.swapIn, filter: `blur(${offset.blurIn}px)` }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: props.reduced ? reducedFade : { ...spring.fade, delay: 0.06 } }}
                  exit={{ opacity: 0, y: props.reduced ? 0 : offset.swapOut, filter: props.reduced ? "none" : `blur(${offset.blurOut}px)`, transition: { duration: 0.12, ease: ease.out } }}>
                  <StageBody stage={state.stage} name={chosen.label} site={SITE[chosen.id]!} onCancel={cancel} reduced={props.reduced} />
                </motion.div>
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </motion.div>}
    </AnimatePresence>
    <Again show={!auto} onClick={replay} />
  </Canvas>;
}

export const connect: Item = {
  id: "flows-ai-connect",
  title: "AI connect, end to end",
  surface: "onboarding + Connect an AI (AiCards, SignInPill, ConnectMotion)",
  height: 380,
  loopMs: 8600,
  notes: {
    original: "real Reveal + StageSwap + ConnectPanel (fake flow): the panel opens on grid rows 280ms css spring, stages crossfade with a 4px rise in 240ms while the box eases height; Connected's check pops from .6 (360ms); the card swaps to its connected look and the panel folds 240ms. Today's waiting copy: \"Finish signing in to Claude in your browser\".",
    a: "calm: panel height on spring.height 300/22, content +80ms; stages rise 8px from 4px blur on spring.fade 420/32, old leaves up in 120ms; arc spinner; \"Waiting for your browser\"; the check draws (ease.inOut); the card's label rolls to Connected.",
    b: "alive: a tray grows out of the pressed card (origin under it, .96 -> 1 on spring.soft 260/24) with a 3-step rail (line fills 160/22, dot to green 260/24, check draws +120ms; DesignBookmark step progress, look only); on Connected it folds back into the card, which tints green and pops a check badge (spring.pop 520/26).",
  },
  Original, A, B,
};
