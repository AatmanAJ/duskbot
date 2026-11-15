import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon, type IconName } from "@/components/Icon";
import { Toggle } from "@/components/ui/Toggle";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/cn";
import { ease, spring } from "@lab/tokens";
import { useLab } from "../shell/prefs";
import { hueVar, type Category, type Hue, type Option, type Row, type Section } from "./model";
import { useSettings } from "./store";
import { useNav } from "./nav";
import { CUSTOM } from "./pages";

/** a category's mark: its icon on a tile of its colour. "tint" is the quiet one, "solid" the iOS one */
export function CategoryIcon({ hue, icon, size = 28, look = "tint", className }: { hue: Hue; icon: IconName; size?: number; look?: "tint" | "solid" | "bare"; className?: string }) {
  const color = hueVar(hue);
  const style: CSSProperties = look === "solid"
    ? { width: size, height: size, background: color, color: "#fdfdfd" }
    : look === "tint"
      ? { width: size, height: size, background: `color-mix(in srgb, ${color} 15%, transparent)`, color }
      : { width: size, height: size, color };
  return (
    <span aria-hidden="true" className={cn("kit-cat-icon", className)} style={style} data-look={look}>
      <Icon name={icon} size={Math.round(size * 0.56)} />
    </span>
  );
}

/** one group of rows on a tonal card, with its label and footnote */
export function SectionView({ section, category, index = 0 }: { section: Section; category?: Category; index?: number }) {
  const { values } = useSettings();
  const rows = section.rows.filter((row) => !("when" in row) || !row.when || row.when(values));
  return (
    <section className="kit-section" style={{ "--kit-hue": category ? hueVar(category.hue) : undefined } as CSSProperties} data-index={index}>
      {section.title && <h3 className="kit-section-title">{section.title}</h3>}
      <div className="kit-group">
        <AnimatePresence initial={false}>
          {rows.map((row) => <RowFold key={rowKey(row)}><RowView row={row} /></RowFold>)}
        </AnimatePresence>
      </div>
      {section.footnote && <p className="kit-footnote">{section.footnote}</p>}
    </section>
  );
}

const rowKey = (row: Row) => (row.kind === "page" ? `page:${row.page}` : row.kind === "link" ? `link:${row.title}` : `${row.kind}:${row.id}`);

/** a row that appears or goes because of another setting folds its height open; the words follow 80ms later */
function RowFold({ children }: { children: ReactNode }) {
  const { reduced } = useLab();
  return (
    <motion.div
      className="kit-fold"
      initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
      animate={reduced ? { opacity: 1 } : { height: "auto", opacity: 1, transition: { height: spring.height, opacity: { duration: 0.2, delay: 0.08 } } }}
      exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0, transition: { height: { duration: 0.18, ease: ease.out }, opacity: { duration: 0.1 } } }}
    >
      {children}
    </motion.div>
  );
}

export function RowShell({ title, hint, icon, children, htmlFor, labelId }: { title: ReactNode; hint?: ReactNode; icon?: IconName; children?: ReactNode; htmlFor?: string; labelId?: string }) {
  return (
    <div className="kit-row">
      {icon && <span className="kit-row-icon" aria-hidden="true"><Icon name={icon} size={15} /></span>}
      <div className="kit-row-text">
        {htmlFor ? <label htmlFor={htmlFor} id={labelId} className="kit-row-title">{title}</label> : <span id={labelId} className="kit-row-title">{title}</span>}
        {hint && <span className="kit-row-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function RowView({ row }: { row: Row }) {
  const { values, set } = useSettings();
  const nav = useNav();
  const id = useId();
  switch (row.kind) {
    case "switch":
      return (
        <RowShell title={row.title} hint={row.hint} icon={row.icon} labelId={id}>
          <Toggle checked={values[row.id] === true} aria-labelledby={id} onClick={() => set(row.id, values[row.id] !== true)} />
        </RowShell>
      );
    case "segmented":
      return (
        <RowShell title={row.title} hint={row.hint} icon={row.icon}>
          <Segmented aria-label={row.title} value={String(values[row.id])} options={row.options} onChange={(value) => set(row.id, value)} />
        </RowShell>
      );
    case "select":
      return (
        <RowShell title={row.title} hint={row.hint} icon={row.icon} labelId={id}>
          <Picker labelId={id} value={String(values[row.id])} options={row.options} onPick={(value) => set(row.id, value)} />
        </RowShell>
      );
    case "page": {
      const count = row.count?.(values);
      return (
        <button type="button" className="kit-row kit-row-button" data-nav={`page:${row.page}`} onClick={() => nav.push({ page: row.page, title: row.title })}>
          {row.icon && <span className="kit-row-icon" aria-hidden="true"><Icon name={row.icon} size={15} /></span>}
          <span className="kit-row-text">
            <span className="kit-row-title">{row.title}</span>
            {row.hint && <span className="kit-row-hint">{row.hint}</span>}
          </span>
          {count !== undefined && <span className="kit-row-value">{count}</span>}
          <Icon name="chevron-right" size={14} className="kit-chevron" />
        </button>
      );
    }
    case "link":
      return (
        <button type="button" className="kit-row kit-row-button" onClick={() => {}}>
          {row.icon && <span className="kit-row-icon" aria-hidden="true"><Icon name={row.icon} size={15} /></span>}
          <span className="kit-row-text"><span className="kit-row-title">{row.title}</span></span>
          <Icon name="link-external" size={13} className="kit-chevron" />
        </button>
      );
    case "action":
      return <ActionRow row={row} />;
    case "custom": {
      const Custom = CUSTOM[row.id];
      return <Custom />;
    }
  }
}

function ActionRow({ row }: { row: Extract<Row, { kind: "action" }> }) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const { speed } = useLab();
  useEffect(() => {
    if (phase !== "busy") return;
    const timer = window.setTimeout(() => setPhase("done"), 1200 / speed);
    return () => window.clearTimeout(timer);
  }, [phase, speed]);
  return (
    <RowShell title={row.title} hint={phase === "done" && row.done ? row.done : row.hint} icon={row.icon}>
      <BusyButton phase={phase} label={row.button} busyLabel="Listening" onClick={() => setPhase(row.done ? "busy" : "idle")} />
    </RowShell>
  );
}

/** a pill that holds a spinner while it works; the label swap rises and blurs in, never jumps */
export function BusyButton({ phase, label, busyLabel, doneLabel, onClick, tone = "quiet", disabled }: {
  phase: "idle" | "busy" | "done";
  label: string;
  busyLabel?: string;
  doneLabel?: string;
  onClick: () => void;
  tone?: "quiet" | "primary" | "success";
  disabled?: boolean;
}) {
  const { reduced } = useLab();
  const text = phase === "busy" ? busyLabel ?? label : phase === "done" ? doneLabel ?? label : label;
  return (
    <motion.button
      type="button"
      layout={reduced ? false : "size"}
      transition={spring.width}
      className="kit-pill dusk-press"
      data-tone={phase === "done" && doneLabel ? "success" : tone}
      aria-busy={phase === "busy" || undefined}
      disabled={disabled || phase === "busy"}
      onClick={onClick}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          className="kit-pill-label"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.2, ease: ease.out } }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, y: -6, filter: "blur(2px)", transition: { duration: 0.12 } }}
        >
          {phase === "busy" && <span className="kit-spinner" aria-hidden="true" />}
          {phase === "done" && doneLabel && <Icon name="check" size={13} />}
          {text}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

/** a pick-one menu anchored to its trigger: it grows from the trigger's corner (.96 and a fade), leaves faster than it
 * came, and moves its highlight with the keyboard at once */
export function Picker({ value, options, onPick, labelId }: { value: string; options: Option[]; onPick: (value: string) => void; labelId?: string }) {
  const { reduced } = useLab();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [up, setUp] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = options.find((option) => option.value === value) ?? options[0]!;

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const scroller = trigger.current.closest(".kit-scroll, .kit-stack, .lab-dialog");
    const box = trigger.current.getBoundingClientRect();
    const scale = box.height / (trigger.current.offsetHeight || 1);
    const room = scroller ? scroller.getBoundingClientRect().bottom - box.bottom : 400;
    setUp(room < Math.min(options.length * 32 + 12, 300) * scale);
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    addEventListener("pointerdown", away, true);
    return () => removeEventListener("pointerdown", away, true);
  }, [open]);

  const choose = (index: number) => {
    onPick(options[index]!.value);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="kit-picker">
      <button
        ref={trigger}
        type="button"
        className="kit-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-labelledby={labelId ? `${labelId} ${menuId}-value` : undefined}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
        }}
      >
        <SwapValue id={`${menuId}-value`} text={current.label} />
        <Icon name="chevrons-up-down" size={13} className="kit-picker-chevron" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={list}
            id={menuId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={`${menuId}-${active}`}
            className="kit-menu"
            data-up={up ? "" : undefined}
            style={{ transformOrigin: up ? "100% 100%" : "100% 0%" }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: up ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: reduced ? { duration: 0.12 } : { ...spring.fade, opacity: { duration: 0.15 } } }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.98, transition: { duration: 0.1, ease: ease.out } }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setActive((at) => Math.min(options.length - 1, at + 1)); }
              else if (event.key === "ArrowUp") { event.preventDefault(); setActive((at) => Math.max(0, at - 1)); }
              else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(active); }
              else if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
            }}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${menuId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                data-active={index === active ? "" : undefined}
                className="kit-menu-item"
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {option.value === value && <Icon name="check" size={13} />}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SwapValue({ text, id }: { text: string; id: string }) {
  const { reduced } = useLab();
  return (
    <span className="kit-swap" id={id}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={text}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.2, ease: ease.out } }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.08 } } : { opacity: 0, y: -6, filter: "blur(2px)", transition: { duration: 0.12 } }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
