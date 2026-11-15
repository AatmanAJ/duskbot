// loading -> success on the buttons a flow waits on: Connect, Save, Start import. click any of them.
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Check, LoaderCircle } from "@/icons";
import { cn } from "@/lib/cn";
import { offset, reducedFade, spring } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { Arc, Canvas, DrawCheck, Swap, useFlow } from "./kit/kit";

type Phase = "idle" | "busy" | "done";
type S = Record<string, Phase>;
const BUTTONS = [
  { id: "connect", idle: "Connect", busy: "Connecting…", done: "Connected" },
  { id: "save", idle: "Save", busy: "Saving…", done: "Saved" },
  { id: "import", idle: "Start import", busy: "Starting…", done: "Import started" },
] as const;
const IDLE: S = { connect: "idle", save: "idle", import: "idle" };
const set = (id: string, phase: Phase) => (s: S) => ({ ...s, [id]: phase });
/** busy at least 800ms (the spinner floor), done for 1.8s, then back */
const press = (id: string): [number, (s: S) => S][] => [[1100, set(id, "done")], [1800, set(id, "idle")]];
const SCRIPT: [number, (s: S) => S][] = [
  [600, set("connect", "busy")], [500, set("save", "busy")], [600, set("connect", "done")], [400, set("import", "busy")],
  [300, set("save", "done")], [800, set("import", "done")], [1000, set("connect", "idle")], [400, set("save", "idle")], [800, set("import", "idle")],
];

const pressAbs = (id: string): [number, (s: S) => S][] => { let at = 0; return press(id).map(([wait, next]) => [(at += wait), next]); };

function useClick(props: LabProps) {
  const flow = useFlow<S>(IDLE, props.replayKey, props.speed, SCRIPT);
  const click = (id: string) => {
    if (flow.state[id] !== "idle") return;
    flow.go(set(id, "busy"));
    for (const [at, next] of pressAbs(id)) flow.later(at, next);
  };
  return { ...flow, click };
}

function Column({ children }: { children: ReactNode }) {
  return <Canvas><div className="flex h-full flex-col items-center justify-center gap-3.5">{children}</div></Canvas>;
}
const BASE = "ui-button ui-button-pill min-h-10 px-5 text-[14px]";

/** today: the label swaps in place with a turning loader and the button disables; done turns it a tinted success fill with a
 * check, all instant (CloudReady's Run now, SignInPill's states) */
function Original(props: LabProps) {
  const { state, click } = useClick(props);
  return <Column>
    {BUTTONS.map((b) => {
      const phase = state[b.id]!;
      return <button key={b.id} type="button" onClick={() => click(b.id)} disabled={phase === "busy"} aria-busy={phase === "busy" || undefined}
        className={cn(BASE, "gap-1.5", phase === "done" ? "!bg-success/15 !text-success" : "ui-button-primary")}>
        {phase === "busy" && <LoaderCircle size={14} aria-hidden="true" className="animate-spin" />}
        {phase === "done" && <Check size={14} strokeWidth={2.5} aria-hidden="true" />}
        {b[phase]}
      </button>;
    })}
  </Column>;
}

/** A: the button keeps its shape; its width follows the label on spring.width; the label swaps (8px rise, 4px blur), an arc
 * fades in, done tints green over 200ms and draws its check */
function A(props: LabProps) {
  const { state, click } = useClick(props);
  const r = props.reduced;
  return <Column>
    {BUTTONS.map((b) => {
      const phase = state[b.id]!;
      return <motion.button key={b.id} layout={!r} type="button" onClick={() => click(b.id)} aria-disabled={phase !== "idle" || undefined} aria-busy={phase === "busy" || undefined}
        transition={spring.width} style={{ borderRadius: 999 }}
        className={cn(BASE, "ui-button-primary transition-[background-color,color] duration-200", phase === "done" && "!bg-success/15 !text-success", phase === "busy" && "cursor-progress")}>
        <Swap id={phase} reduced={r}>
          {phase === "busy" && <Arc size={14} reduced={r} />}
          {phase === "done" && <DrawCheck size={14} reduced={r} />}
          {b[phase]}
        </Swap>
      </motion.button>;
    })}
  </Column>;
}

/** B: the label drops away and the button folds into a 40px circle with an arc (spring 300/22); at done it opens into a
 * green pill, the check draws +150ms and the label rises 12px; back to idle after 1.8s. DesignBookmark loading-to-success,
 * look only, rebuilt with our tokens */
function B(props: LabProps) {
  const { state, click } = useClick(props);
  const r = props.reduced;
  const fold = { type: "spring", stiffness: 300, damping: 22 } as const;
  return <Column>
    {BUTTONS.map((b) => {
      const phase = state[b.id]!;
      return <motion.button key={b.id} layout={!r} type="button" onClick={() => click(b.id)} aria-disabled={phase !== "idle" || undefined} aria-busy={phase === "busy" || undefined}
        aria-label={phase === "busy" ? b.busy : undefined} transition={r ? reducedFade : fold} style={{ borderRadius: 999 }}
        className={cn("ui-button ui-button-pill min-h-10 overflow-hidden text-[14px] transition-[background-color,color] duration-200",
          phase === "busy" ? "w-10 cursor-progress !px-0 ui-button-primary" : "px-5", phase === "done" ? "!bg-success !text-white" : "ui-button-primary")}>
        {phase === "busy"
          ? <motion.span key="arc" className="grid place-items-center" initial={{ opacity: 0, scale: r ? 1 : 0.6 }} animate={{ opacity: 1, scale: 1 }}
            transition={r ? reducedFade : { type: "spring", stiffness: 300, damping: 28, delay: 0.06 }}><Arc size={16} reduced={r} /></motion.span>
          : <motion.span key={phase} layout="position" className="inline-flex items-center gap-1.5 whitespace-nowrap"
            initial={{ opacity: 0, y: r ? 0 : phase === "done" ? offset.rise : offset.swapIn }} animate={{ opacity: 1, y: 0 }}
            transition={r ? reducedFade : { type: "spring", stiffness: 220, damping: 20, delay: 0.12 }}>
            {phase === "done" && <DrawCheck size={15} reduced={r} delay={0.15} draw={0.32} />}
            {b[phase]}
          </motion.span>}
      </motion.button>;
    })}
  </Column>;
}

export const buttons: Item = {
  id: "flows-loading-success",
  title: "loading -> success buttons",
  surface: "Connect, Save, Start import (flows, settings)",
  height: 260,
  loopMs: 5600,
  notes: {
    original: "today: label swaps in place to \"Saving…\" with a spinning loader and the button disables; done is an instant tinted success fill with a check. No motion between states. Click any button.",
    a: "calm: the shape stays; width follows the label on spring.width 380/24; labels swap 8px/blur 4 on spring.fade; arc spinner (min 800ms); done tints green in 200ms and the check draws (ease.inOut).",
    b: "alive: folds into a 40px circle with an arc (300/22), then opens into a solid green pill; check draws +150ms, label rises 12px (220/20); resets after 1.8s. DesignBookmark loading-to-success, look only, rebuilt.",
  },
  Original, A, B,
};

