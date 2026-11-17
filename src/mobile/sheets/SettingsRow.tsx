import { useId, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronRight } from "../../icons";
import { cn } from "@/lib/cn";
import { dur, spring } from "../motion";

/** A group of rows. As a `card` it is iOS Settings' inset group: a quiet label over one tonal card, a hint under it;
 * otherwise a quiet label over plain rows, as a list's day headings. */
export function SettingsSection({ title, hint, card = false, children }: { title?: string; hint?: ReactNode; card?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={title ? id : undefined} className={cn(card ? "mt-7 px-2" : "mt-6", "first:mt-0")}>
      {title && <h2 id={id} className="px-4 pb-1 text-[14px] font-medium text-ink-secondary">{title}</h2>}
      {card ? <div data-settings-card="" className="overflow-hidden rounded-[20px] bg-ink/[0.045] [&_.mobile-row]:rounded-none">{children}</div> : children}
      {hint && <p className="px-4 pt-2 text-[13px] leading-[18px] text-ink-secondary">{hint}</p>}
    </section>
  );
}

export function SettingsRow({ icon, label, detail, value, onClick, href, chevron = Boolean(onClick || href), danger = false }: {
  icon?: ReactNode;
  label: string;
  detail?: string;
  value?: ReactNode;
  onClick?: () => void;
  href?: string;
  chevron?: boolean;
  danger?: boolean;
}) {
  const className = cn("flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-4 py-2 text-left", (onClick || href) && "mobile-row", danger ? "text-danger" : "text-ink");
  const content = <>
    {icon && <span aria-hidden className="shrink-0 text-ink-secondary [&>svg]:size-5">{icon}</span>}
    <span className="min-w-0 flex-1">
      <span className="block text-[16px] font-medium">{label}</span>
      {detail && <span className="mt-0.5 block text-[13px] leading-[18px] text-ink-secondary">{detail}</span>}
    </span>
    {value != null && <span className="max-w-[45%] shrink-0 truncate text-[15px] text-ink-secondary">{value}</span>}
    {chevron && <ChevronRight aria-hidden size={18} className="shrink-0 text-ink-tertiary" />}
  </>;
  if (href) return <a href={href} onClick={onClick} className={className}>{content}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={className}>{content}</button>;
  return <div className={className}>{content}</div>;
}

export function SettingsSwitch({ icon, label, detail, checked, onChange }: { icon?: ReactNode; label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  const reduced = useReducedMotion();
  return (
    <motion.button type="button" role="switch" aria-checked={checked} aria-labelledby={id} aria-describedby={detail ? `${id}-detail` : undefined} onClick={() => onChange(!checked)} whileTap={reduced ? undefined : "pressed"} className="mobile-row flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-4 py-2 text-left text-ink">
      {icon && <span aria-hidden className="shrink-0 text-ink-secondary [&>svg]:size-5">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span id={id} className="block text-[16px] font-medium">{label}</span>
        {detail && <span id={`${id}-detail`} className="mt-0.5 block text-[13px] leading-[18px] text-ink-secondary">{detail}</span>}
      </span>
      <span aria-hidden className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors motion-reduce:transition-none", checked ? "bg-ink" : "bg-ink/[0.14]")} style={{ transitionDuration: reduced ? "0s" : `${dur.slow}s` }}>
        <motion.span className="absolute left-0.5 top-0.5 block size-[27px] rounded-full bg-app shadow-sm" initial={false} animate={{ x: checked ? 20 : 0 }} transition={reduced ? { duration: 0 } : { ...spring.settle, stiffness: 420, damping: 28 }} variants={{ pressed: { scaleX: 1.11, scaleY: 0.9 } }} />
      </span>
    </motion.button>
  );
}
