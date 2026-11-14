import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, animate, motion } from "motion/react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { ELEVATED_FLOAT } from "@/components/elevated";
import { MENU_GUTTER, MENU_LABEL, MENU_ROW, MENU_SEPARATOR, SIMPLE_MENU_META, SIMPLE_MENU_ROW } from "@/components/menu-recipe";
import { dur, ease, ms, spring, stagger } from "@lab/tokens";
import type { LabProps } from "@lab/types";
import { useLater, useScript } from "./kit";

type Model = { key: string; label: string; provider: string };
const GROUPS: Array<{ provider: string; models: Model[] }> = [
  { provider: "Claude", models: [{ key: "opus", label: "Opus 5.5", provider: "Claude" }, { key: "sonnet", label: "Sonnet 5", provider: "Claude" }, { key: "haiku", label: "Haiku 4.5", provider: "Claude" }] },
  { provider: "ChatGPT", models: [{ key: "gpt", label: "GPT-5.5", provider: "ChatGPT" }, { key: "mini", label: "GPT-5.5 mini", provider: "ChatGPT" }] },
];
const ALL = GROUPS.flatMap((group) => group.models);

/** open the picker, star a model, star another, unstar the first, pick one */
function usePickerDemo({ replayKey, speed }: LabProps) {
  const [open, setOpen] = useState(false);
  const [starred, setStarred] = useState<string[]>([]);
  const [current, setCurrent] = useState("opus");
  const [lastStar, setLastStar] = useState<string | null>(null);
  const toggle = (key: string) => {
    setLastStar(key);
    setStarred((all) => (all.includes(key) ? all.filter((k) => k !== key) : [...all, key]));
  };
  const later = useLater(speed);
  const pick = (key: string) => {
    setCurrent(key);
    later(120, () => setOpen(false));
  };
  const stop = useScript(replayKey, speed, [
    [500, () => setOpen(true)], [900, () => toggle("gpt")], [900, () => toggle("sonnet")], [1100, () => toggle("gpt")], [1000, () => pick("sonnet")],
  ], () => { setOpen(false); setStarred([]); setCurrent("opus"); });
  return {
    open, starred, current, lastStar,
    setOpen: (value: boolean) => { stop(); setOpen(value); },
    toggle: (key: string) => { stop(); toggle(key); },
    pick: (key: string) => { stop(); pick(key); },
  };
}
type Demo = ReturnType<typeof usePickerDemo>;

/** keeps a closing surface mounted for its exit, as MenuMotion's useMenuMotion does (150ms, at the lab's speed) */
function useMenuMount(open: boolean, speed: number, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  useLayoutEffect(() => {
    if (open) { setMounted(true); return; }
    if (!mounted) return;
    const timer = window.setTimeout(() => setMounted(false), ms(exitMs, speed));
    return () => window.clearTimeout(timer);
  }, [open, mounted, speed, exitMs]);
  return { shown: open || mounted, closing: !open && mounted };
}

function Trigger({ demo, label }: { demo: Demo; label: string }) {
  return (
    <button type="button" aria-expanded={demo.open} aria-haspopup="dialog" onClick={() => demo.setOpen(!demo.open)}
      className={cn("group flex h-8 shrink-0 items-center rounded-full pl-2.5 pr-2 text-[13px] leading-[18px] text-ink-secondary inset-ring inset-ring-ink/[0.07]", ELEVATED_FLOAT,
        "aria-expanded:bg-[color-mix(in_srgb,var(--color-composer),var(--color-ink)_7%)] aria-expanded:text-ink focus-visible:outline-2 focus-visible:outline-focus")}>
      <span className="mr-1.5 size-3.5 rounded-full bg-[#d97757]" aria-hidden />
      <span className="truncate">{label}</span>
      <Icon name="chevron-down" size={12} className="ml-1 shrink-0 text-ink-tertiary" />
    </button>
  );
}

type StarLook = "plain" | "pop";

function StarButton({ on, label, look, onClick }: { on: boolean; label: string; look: StarLook; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `unstar ${label}` : `star ${label}`} onClick={onClick}
      className={cn("absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-[6px] text-ink-tertiary transition-colors hover:bg-ink/[0.08] hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus",
        on ? "text-accent hover:text-accent" : "opacity-0 group-hover/star:opacity-100 group-focus-within/star:opacity-100")}>
      {look === "pop" ? (
        <motion.span key={on ? "on" : "off"} className="flex" initial={{ scale: on ? 0.6 : 0.9 }} animate={{ scale: 1, transition: on ? spring.pop : { duration: dur.fast, ease: ease.out } }}>
          <Icon name="star" size={14} variant={on ? "filled" : "outline"} />
        </motion.span>
      ) : <Icon name="star" size={14} variant={on ? "filled" : "outline"} />}
    </button>
  );
}

function ModelRow({ model, demo, route, look, rowId }: { model: Model; demo: Demo; route?: string; look: StarLook; rowId?: string }) {
  const on = demo.starred.includes(model.key);
  return (
    <div className="group/star relative" data-row={rowId}>
      <button type="button" aria-pressed={demo.current === model.key} onClick={() => demo.pick(model.key)} className={cn(SIMPLE_MENU_ROW, "pr-8")}>
        <span className={MENU_GUTTER} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{model.label}</span>
          {route && <span className={SIMPLE_MENU_META}>{route}</span>}
        </span>
        {demo.current === model.key && <Icon name="check" size={14} className="shrink-0 text-accent" />}
      </button>
      <StarButton on={on} label={model.label} look={look} onClick={() => demo.toggle(model.key)} />
    </div>
  );
}

const StarredLabel = () => (
  <div className={MENU_LABEL}>
    <span className={MENU_GUTTER}><Icon name="star" size={14} variant="filled" className="text-ink-tertiary" /></span>
    <span className="min-w-0 truncate">Starred</span>
  </div>
);

const GroupLabel = ({ name }: { name: string }) => (
  <div className={MENU_LABEL}>
    <span className={MENU_GUTTER}><span className={cn("size-3.5 rounded-full", name === "Claude" ? "bg-[#d97757]" : "bg-ink/70")} aria-hidden /></span>
    <span className="min-w-0 truncate">{name}</span>
  </div>
);

const Footer = () => (
  <div className="flex shrink-0 flex-col gap-0.5 p-1.5 pt-0">
    <div role="separator" className={MENU_SEPARATOR} />
    <button type="button" className={MENU_ROW}>
      <span className={MENU_GUTTER}><Icon name="plus" size={16} className="text-ink-secondary" /></span>
      <span className="min-w-0 flex-1 truncate">More AIs</span>
      <Icon name="chevron-right" size={16} className="text-ink-tertiary" />
    </button>
  </div>
);

/** the picker's stage: the trigger at the bottom left, as in the composer's top row, the popover above it */
function PickerStage({ demo, children }: { demo: Demo; children: ReactNode }) {
  const label = ALL.find((m) => m.key === demo.current)?.label ?? "";
  return (
    <div className="relative h-full w-full">
      <div className="absolute bottom-4 left-4">
        <Trigger demo={demo} label={label} />
      </div>
      <div className="absolute bottom-[56px] left-4" style={{ width: "min(300px, calc(100% - 32px))" }}>{children}</div>
    </div>
  );
}

const SURFACE = "menu-surface flex w-full flex-col overflow-hidden";

/* ---------------- Original ---------------- */

export function PickerOriginal(props: LabProps) {
  const demo = usePickerDemo(props);
  const mount = useMenuMount(demo.open, props.speed, 150);
  return (
    <PickerStage demo={demo}>
      {mount.shown && (
        <div role="dialog" aria-label="choose a model" aria-modal="false" style={{ transformOrigin: "0 100%" }}
          className={cn(SURFACE, mount.closing ? "animate-pop-out pointer-events-none" : "animate-pop-in")}>
          <div className="flex flex-col gap-0.5 p-1.5">
            {demo.starred.length > 0 && (
              <div role="group" aria-label="starred" className="mb-1 flex flex-col gap-0.5">
                <StarredLabel />
                {demo.starred.map((key) => <ModelRow key={key} model={ALL.find((m) => m.key === key)!} demo={demo} route={ALL.find((m) => m.key === key)!.provider} look="plain" />)}
              </div>
            )}
            {GROUPS.map((group, i) => (
              <div key={group.provider} role="group" aria-label={group.provider} className={cn("flex flex-col gap-0.5", i > 0 && "mt-1")}>
                <GroupLabel name={group.provider} />
                {group.models.map((model) => <ModelRow key={model.key} model={model} demo={demo} look="plain" />)}
              </div>
            ))}
          </div>
          <Footer />
        </div>
      )}
    </PickerStage>
  );
}

/* ---------------- A: calm ---------------- */

function MenuBody({ demo, look, rowStagger }: { demo: Demo; look: StarLook; rowStagger: boolean }) {
  const layout = look === "pop" ? spring.settle : spring.layout;
  const rows = GROUPS.flatMap((group) => group.models.map((model) => model.key));
  const rise = (key: string) => rowStagger
    ? { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0, transition: { ...spring.fade, delay: Math.min(rows.indexOf(key) * stagger.in, stagger.capTotal) } } }
    : {};
  return (
    <div className="flex flex-col gap-0.5 p-1.5">
      <AnimatePresence initial={false}>
        {demo.starred.length > 0 && (
          <motion.div key="starred" role="group" aria-label="starred" className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1, transition: { height: layout, opacity: { duration: dur.fast } } }}
            exit={{ height: 0, opacity: 0, transition: { duration: dur.fast, ease: ease.out } }}>
            <div className="mb-1 flex flex-col gap-0.5">
              <StarredLabel />
              <AnimatePresence initial={false}>
                {demo.starred.map((key) => {
                  const model = ALL.find((m) => m.key === key)!;
                  return (
                    <motion.div key={key} className="overflow-hidden" data-starred-row={key}
                      initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1, transition: { height: layout, opacity: { duration: dur.swap, delay: 0.06 } } }}
                      exit={{ height: 0, opacity: 0, transition: { duration: dur.fast, ease: ease.out } }}>
                      <ModelRow model={model} demo={demo} route={model.provider} look={look} />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {GROUPS.map((group, i) => (
        <div key={group.provider} role="group" aria-label={group.provider} className={cn("flex flex-col gap-0.5", i > 0 && "mt-1")}>
          <GroupLabel name={group.provider} />
          {group.models.map((model) => (
            <motion.div key={model.key} {...rise(model.key)} data-source-row={model.key}>
              <ModelRow model={model} demo={demo} look={look} />
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PickerA(props: LabProps) {
  const demo = usePickerDemo(props);
  return (
    <PickerStage demo={demo}>
      <AnimatePresence>
        {demo.open && (
          <motion.div key="menu" role="dialog" aria-label="choose a model" aria-modal="false" style={{ transformOrigin: "0 100%" }} className={SURFACE}
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1, transition: { duration: 0.16, ease: ease.out } }}
            exit={{ opacity: 0, scale: 0.99, transition: { duration: dur.exit, ease: ease.out } }}>
            <MenuBody demo={demo} look="plain" rowStagger={false} />
            <Footer />
          </motion.div>
        )}
      </AnimatePresence>
    </PickerStage>
  );
}

/* ---------------- B: alive ---------------- */

/** a newly starred row lifts out of its place in the list and settles into Starred */
function useStarFlight(demo: Demo, root: React.RefObject<HTMLDivElement | null>, reduced: boolean) {
  const seen = useRef<string[]>(demo.starred);
  useLayoutEffect(() => {
    const added = demo.starred.filter((key) => !seen.current.includes(key));
    seen.current = demo.starred;
    const el = root.current;
    if (!el || reduced) return;
    for (const key of added) {
      const target = el.querySelector<HTMLElement>(`[data-starred-row="${key}"] [data-row]`) ?? el.querySelector<HTMLElement>(`[data-starred-row="${key}"]`);
      const source = el.querySelector<HTMLElement>(`[data-source-row="${key}"]`);
      if (!target || !source) continue;
      const dy = source.getBoundingClientRect().top - target.getBoundingClientRect().top;
      const controls = animate(target, { y: [dy, 0] }, spring.settle);
      return () => controls.stop();
    }
  }, [demo.starred, root, reduced]);
}

export function PickerB(props: LabProps) {
  const demo = usePickerDemo(props);
  const root = useRef<HTMLDivElement>(null);
  useStarFlight(demo, root, props.reduced);
  return (
    <PickerStage demo={demo}>
      <AnimatePresence>
        {demo.open && (
          <motion.div key="menu" ref={root} role="dialog" aria-label="choose a model" aria-modal="false" style={{ transformOrigin: "0 100%" }} className={SURFACE}
            initial={{ opacity: 0, clipPath: "inset(70% 0% 0% 0% round 14px)", y: 4 }}
            animate={{ opacity: 1, clipPath: "inset(0% 0% 0% 0% round 14px)", y: 0, transition: { clipPath: spring.height, y: spring.height, opacity: { duration: dur.fast } } }}
            exit={{ opacity: 0, y: 2, transition: { duration: dur.exit, ease: ease.out } }}>
            <MenuBody demo={demo} look="pop" rowStagger />
            <Footer />
          </motion.div>
        )}
      </AnimatePresence>
    </PickerStage>
  );
}
