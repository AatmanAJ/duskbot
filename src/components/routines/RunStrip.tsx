import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { RoutineStripEntry } from "@/lib/routines";
import { deviceHourCycle } from "@/lib/format-time";

const MARK: Record<RoutineStripEntry["outcome"], { mark: string; tone: string }> = {
  ok: { mark: "✓", tone: "text-success" },
  quiet: { mark: "✓", tone: "text-ink-tertiary" },
  failed: { mark: "✗", tone: "text-danger" },
  missed: { mark: "○", tone: "text-warning" },
  skipped: { mark: "–", tone: "text-ink-tertiary" },
};

const when = (at: number) => new Date(at).toLocaleString(activeLocale(), { weekday: "short", hour: "numeric", minute: "2-digit", hourCycle: deviceHourCycle() });

/** A routine's last seven outcomes, oldest first: ✓ did something, a dim ✓ fired with nothing new, ✗ failed, ○ didn't
 * fire, – the weekly limit skipped it. Each says which in words for a screen reader and on hover, and the line under it counts them. */
export function RunStrip({ strip }: { strip: RoutineStripEntry[] }) {
  const counts = (outcome: RoutineStripEntry["outcome"]) => strip.filter((entry) => entry.outcome === outcome).length;
  const summary = (["ok", "quiet", "failed", "missed", "skipped"] as const)
    .filter((outcome) => counts(outcome) > 0)
    .map((outcome) => t(`routines.strip.count.${outcome}`, { count: String(counts(outcome)) }))
    .join(" · ");
  return (
    <span className="mt-0.5 flex flex-col gap-0.5" data-routine-strip="">
      <span className="flex items-center gap-1.5" role="list" aria-label={t("routines.strip.term")}>
        {strip.map((entry) => {
          const words = `${t(`routines.strip.${entry.outcome}`)}${entry.rerun ? ` · ${t("routines.strip.rerun")}` : ""} · ${when(entry.at)}`;
          return (
            <span key={`${entry.at}:${entry.outcome}`} role="listitem" title={words} aria-label={words} data-strip-outcome={entry.outcome}
              className={cn("relative inline-flex size-5 items-center justify-center rounded-md bg-ink/[0.04] text-[12px] leading-none", MARK[entry.outcome].tone)}>
              {MARK[entry.outcome].mark}
              {entry.rerun && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent" />}
            </span>
          );
        })}
      </span>
      <span className="text-[12px] leading-4 text-ink-secondary">{summary}</span>
    </span>
  );
}
