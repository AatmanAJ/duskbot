import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Segmented } from "@/components/ui/Segmented";
import { SlidingPills } from "@/components/ui/SlidingPills";
import { MausAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { dur, ease, offset, spring, stagger } from "@lab/tokens";
import type { LabProps } from "@lab/types";
import { useScript, useStretch } from "./kit";

const THEMES = [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }] as const;
const EFFORT = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "max", label: "Max" }] as const;
type Theme = (typeof THEMES)[number]["value"];
type Effort = (typeof EFFORT)[number]["value"];

function usePillsDemo({ replayKey, speed }: LabProps) {
  const [theme, setTheme] = useState<Theme>("light");
  const [effort, setEffort] = useState<Effort>("medium");
  const stop = useScript(replayKey, speed, [
    [600, () => setTheme("system")], [700, () => setEffort("max")], [700, () => setTheme("dark")], [500, () => setEffort("low")], [600, () => setTheme("light")], [500, () => setEffort("high")],
  ], () => { setTheme("light"); setEffort("medium"); });
  return { theme, effort, setTheme: (v: Theme) => { stop(); setTheme(v); }, setEffort: (v: Effort) => { stop(); setEffort(v); } };
}

const Label = ({ children, id }: { children: string; id: string }) => <span id={id} className="text-[12px] font-medium leading-4 text-ink-tertiary">{children}</span>;

function Layout({ theme, effort, idPrefix }: { theme: React.ReactNode; effort: React.ReactNode; idPrefix: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-4">
      <div className="flex w-full max-w-[280px] items-center justify-between gap-3">
        <span className="text-[13px] text-ink">Appearance</span>
        {theme}
      </div>
      <div className="flex w-full max-w-[280px] flex-col gap-1 rounded-[14px] bg-menu p-1.5 shadow-(--shadow-popover)">
        <span className="px-2"><Label id={`${idPrefix}-effort`}>Thinking</Label></span>
        {effort}
      </div>
    </div>
  );
}

export function PillsOriginal(props: LabProps) {
  const demo = usePillsDemo(props);
  return (
    <Layout idPrefix="po"
      theme={<Segmented aria-label="appearance" value={demo.theme} options={THEMES} onChange={demo.setTheme} />}
      effort={<SlidingPills aria-labelledby="po-effort" value={demo.effort} onPick={demo.setEffort} pillClassName="px-1" options={EFFORT} />} />
  );
}

type Look = "calm" | "stretch";

/** a measured pill under the chosen option: calm glides on one spring, stretch moves its two edges on lead and trail */
export function Pill<V extends string>({ value, options, onChange, look, variant, label, labelledBy, reduced }: {
  value: V; options: readonly { value: V; label: string }[]; onChange: (v: V) => void; look: Look;
  variant: "segmented" | "sliding"; label?: string; labelledBy?: string; reduced: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ start: number; end: number; top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const chosen = group.current?.querySelector<HTMLElement>(`[data-value="${value}"]`);
    if (!chosen) return;
    setBox({ start: chosen.offsetLeft, end: chosen.offsetLeft + chosen.offsetWidth, top: chosen.offsetTop, height: chosen.offsetHeight });
  }, [value]);
  const stretch = useStretch(look === "stretch" && box ? { start: box.start, end: box.end } : null, reduced);
  const move = (event: KeyboardEvent, by: number) => {
    event.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[(at + by + options.length) % options.length]!;
    onChange(next.value);
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };
  const segmented = variant === "segmented";
  return (
    <div ref={group} role="radiogroup" aria-label={label} aria-labelledby={labelledBy}
      onKeyDown={(event) => { if (event.key === "ArrowRight") move(event, 1); else if (event.key === "ArrowLeft") move(event, -1); }}
      className={cn("relative isolate", segmented ? "inline-flex h-7 shrink-0 items-center gap-0.5 rounded-full bg-ink/[0.06] p-0.5" : "m-1 grid rounded-full bg-ink/[0.05] p-[3px]")}
      style={segmented ? undefined : { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {box && (look === "stretch"
        ? <motion.span aria-hidden className={cn("pointer-events-none absolute left-0 -z-10 rounded-full", segmented ? "segmented-fill" : "bg-ink/[0.1]")}
            style={{ x: stretch.start, width: stretch.size, top: box.top, height: box.height }} />
        : <motion.span aria-hidden className={cn("pointer-events-none absolute left-0 -z-10 rounded-full", segmented ? "segmented-fill" : "bg-ink/[0.1]")}
            initial={false} animate={{ x: box.start, width: box.end - box.start }} transition={reduced ? { duration: 0 } : spring.layout}
            style={{ top: box.top, height: box.height }} />)}
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <motion.button key={option.value} type="button" role="radio" aria-checked={checked} data-value={option.value} tabIndex={checked ? 0 : -1}
            onClick={() => !checked && onChange(option.value)}
            whileTap={reduced ? undefined : { scale: look === "stretch" ? 0.96 : 0.98 }}
            transition={{ duration: dur.press, ease: ease.out }}
            className={cn("min-w-0 cursor-pointer whitespace-nowrap rounded-full transition-colors duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
              segmented ? "h-6 px-2.5 text-[13px] leading-6" : "h-6 truncate px-1 text-[12px] leading-4",
              checked ? "text-ink" : "text-ink-secondary hover:text-ink")}>
            {option.label}
          </motion.button>
        );
      })}
    </div>
  );
}

export function PillsA(props: LabProps) {
  const demo = usePillsDemo(props);
  return (
    <Layout idPrefix="pa"
      theme={<Pill variant="segmented" look="calm" label="appearance" value={demo.theme} options={THEMES} onChange={demo.setTheme} reduced={props.reduced} />}
      effort={<Pill variant="sliding" look="calm" labelledBy="pa-effort" value={demo.effort} options={EFFORT} onChange={demo.setEffort} reduced={props.reduced} />} />
  );
}

export function PillsB(props: LabProps) {
  const demo = usePillsDemo(props);
  return (
    <Layout idPrefix="pb"
      theme={<Pill variant="segmented" look="stretch" label="appearance" value={demo.theme} options={THEMES} onChange={demo.setTheme} reduced={props.reduced} />}
      effort={<Pill variant="sliding" look="stretch" labelledBy="pb-effort" value={demo.effort} options={EFFORT} onChange={demo.setEffort} reduced={props.reduced} />} />
  );
}

/* ---------------- scope: This bot | All bots ---------------- */

const SCOPES = [{ value: "bot", label: "This bot" }, { value: "all", label: "All bots" }] as const;
type Scope = (typeof SCOPES)[number]["value"];
const HINT: Record<Scope, string> = { bot: "Only this bot uses the model you pick.", all: "Every bot uses the model you pick, and new bots start on it." };
const OTHERS = ["blue", "pink", "orange", "purple"] as const;

function useScopeDemo({ replayKey, speed }: LabProps) {
  const [scope, setScope] = useState<Scope>("bot");
  const stop = useScript(replayKey, speed, [[700, () => setScope("all")], [1500, () => setScope("bot")], [1300, () => setScope("all")]], () => setScope("bot"));
  return { scope, set: (v: Scope) => { stop(); setScope(v); } };
}

function ScopeBand({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-4">
      <div className="flex w-full max-w-[300px] flex-col rounded-[14px] bg-menu p-1.5 shadow-(--shadow-popover)">
        <span id={id} className="flex h-6 items-end px-2 pb-0.5 text-[12px] font-medium leading-4 text-ink-tertiary">Use this model for</span>
        {children}
      </div>
    </div>
  );
}

export function ScopeOriginal(props: LabProps) {
  const demo = useScopeDemo(props);
  return (
    <ScopeBand id="so-scope">
      <SlidingPills aria-labelledby="so-scope" value={demo.scope} onPick={demo.set}
        options={SCOPES.map((s) => ({ value: s.value, label: s.label, title: HINT[s.value] }))} />
    </ScopeBand>
  );
}

function HintLine({ scope, lively }: { scope: Scope; lively: boolean }) {
  const dir = scope === "all" ? 1 : -1;
  return (
    <div className="relative min-h-8 overflow-hidden px-2 pt-1 text-[12px] leading-4 text-ink-tertiary" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p key={scope}
          initial={lively ? { opacity: 0, x: dir * 14, filter: "blur(3px)" } : { opacity: 0, y: offset.swapIn, filter: "blur(2px)" }}
          animate={{ opacity: 1, x: 0, y: 0, filter: "blur(0px)", transition: lively ? spring.fade : { duration: dur.swap, ease: ease.out } }}
          exit={lively ? { opacity: 0, x: dir * -10, filter: "blur(2px)", transition: { duration: dur.exit } } : { opacity: 0, y: offset.swapOut, filter: "blur(2px)", transition: { duration: dur.exit } }}>
          {HINT[scope]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

export function ScopeA(props: LabProps) {
  const demo = useScopeDemo(props);
  return (
    <ScopeBand id="sa-scope">
      <Pill variant="sliding" look="calm" labelledBy="sa-scope" value={demo.scope} options={SCOPES} onChange={demo.set} reduced={props.reduced} />
      <HintLine scope={demo.scope} lively={false} />
    </ScopeBand>
  );
}

/** B: the stretchy thumb, the hint slides the way the thumb went, and the bots it applies to gather beside it */
export function ScopeB(props: LabProps) {
  const demo = useScopeDemo(props);
  const all = demo.scope === "all";
  return (
    <ScopeBand id="sb-scope">
      <Pill variant="sliding" look="stretch" labelledBy="sb-scope" value={demo.scope} options={SCOPES} onChange={demo.set} reduced={props.reduced} />
      <div className="flex items-start gap-2 pe-2">
        <div className="min-w-0 flex-1"><HintLine scope={demo.scope} lively /></div>
        <div className="mt-1.5 flex shrink-0 items-center" aria-hidden>
          <MausAvatar color="green" size={18} label="" />
          <AnimatePresence initial={false}>
            {all && OTHERS.map((color, i) => (
              <motion.span key={color} className="-ms-1.5 flex rounded-full ring-2 ring-menu"
                initial={{ opacity: 0, x: -8, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1, transition: { ...spring.pop, delay: i * stagger.in } }}
                exit={{ opacity: 0, x: -6, transition: { duration: dur.exit } }}>
                <MausAvatar color={color} size={18} label="" />
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </ScopeBand>
  );
}
