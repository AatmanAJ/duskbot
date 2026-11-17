import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { MASCOT_INK } from "@/lib/mascot";
import { EASE } from "@/lib/motion-presets";
import { fetchDaily, type DailyUsageReport, type DailyUsageSeries } from "@/lib/spend";
import { formatTokens } from "@/lib/usage";
import { formatCost } from "@/lib/usage-trace";
import { useStoreSelector, type Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { Card as RowsCard } from "../ListRows";

const DAYS = 14;
const H = 168;
const PAD = { top: 10, right: 10, bottom: 24, left: 46 };
const OTHER = "color-mix(in srgb, var(--color-ink) 32%, transparent)";

export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return (n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 6 ? 6 : n <= 8 ? 8 : 10) * pow;
}

/** A monotone cubic through the points (Fritsch-Carlson), so a curve never overshoots below zero or past a peak. */
export function smoothPath(points: readonly (readonly [number, number])[]): string {
  if (points.length === 0) return "";
  if (points.length < 3) return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const n = points.length;
  const dx = points.slice(1).map(([x], i) => x - points[i]![0]);
  const slope = points.slice(1).map(([, y], i) => (y - points[i]![1]) / (dx[i] || 1));
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0]!;
    if (i === n - 1) return slope[n - 2]!;
    const a = slope[i - 1]!, b = slope[i]!;
    return a * b <= 0 ? 0 : (3 * (dx[i - 1]! + dx[i]!)) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b);
  });
  let d = `M${points[0]![0].toFixed(1)},${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = points[i]!, [x1, y1] = points[i + 1]!, h = dx[i]! / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + tangent[i]! * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - tangent[i + 1]! * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

const dayDate = (day: string) => new Date(`${day}T12:00:00`);
const shortDay = (day: string) => dayDate(day).toLocaleDateString(activeLocale(), { month: "short", day: "numeric" });
const longDay = (day: string) => dayDate(day).toLocaleDateString(activeLocale(), { weekday: "short", month: "short", day: "numeric" });

function useDaily(version: number) {
  const [report, setReport] = useState<DailyUsageReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setFailed(false);
    fetchDaily(DAYS).then((next) => { if (current) setReport(next); }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [version, attempt]);
  return { report, failed, retry: () => setAttempt((n) => n + 1) };
}

function colorOf(series: DailyUsageSeries, bots: readonly Bot[]): string {
  const bot = series.botId ? bots.find((one) => one.id === series.botId) : undefined;
  return bot ? MASCOT_INK[bot.color] ?? MASCOT_INK.blue : OTHER;
}

function SeriesMark({ bot, color }: { bot: Bot | undefined; color: string }) {
  return bot
    ? <BotAvatar bot={bot} state="idle" size={14} animated={false} />
    : <span aria-hidden="true" className="mx-[3px] size-2 shrink-0 rounded-full" style={{ background: color }} />;
}

/** Each bot's use per day over the last two weeks: one line in its mascot's colour, the busiest washed underneath.
 * The pointer or the arrow keys pick a day and name what each bot used on it. */
export function UsageGraph({ version = 0 }: { version?: number }) {
  const bots = useStoreSelector((s) => s.bots);
  const { report, failed, retry } = useDaily(version);
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  const [at, setAt] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setW(Math.max(260, el.clientWidth));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [report !== null]);

  const amount = (value: number) => (report?.basis === "tokens" ? formatTokens(Math.round(value)) : formatCost(value));
  const action = report && report.total > 0
    ? <span className="tabular-nums text-ink-secondary">{t("usage.graph.total", { amount: amount(report.total) })}</span>
    : undefined;

  if (failed && !report) {
    return (
      <RowsCard label={t("usage.graph.title")} data-settings-block="usage-graph">
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[13px] leading-[18px]">
          <span role="alert" className="text-ink-secondary">{t("usage.graph.failed")}</span>
          <button type="button" onClick={retry} className="ui-button">{t("usage.graph.retry")}</button>
        </div>
      </RowsCard>
    );
  }
  if (!report) {
    return (
      <RowsCard label={t("usage.graph.title")} data-settings-block="usage-graph">
        <div aria-busy="true" aria-label={t("common.checking")} className="m-1 animate-pulse rounded-[9px] bg-ink/[0.035]" style={{ height: H }} />
      </RowsCard>
    );
  }

  const { days, series } = report;
  const empty = report.total <= 0;
  const max = niceMax(Math.max(0, ...series.flatMap((one) => one.values)));
  const iw = w - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length <= 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (value: number) => PAD.top + ih - (value / max) * ih;
  const ticks = empty ? [0] : [0, max / 2, max];
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(iw / 70))));
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    if (empty) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rel = (event.clientX - rect.left - PAD.left) / Math.max(1, iw);
    setAt(Math.max(0, Math.min(days.length - 1, Math.round(rel * (days.length - 1)))));
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (empty || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    setAt((current) => Math.max(0, Math.min(days.length - 1, (current ?? days.length - 1) + (event.key === "ArrowRight" ? 1 : -1))));
  };
  const colors = series.map((one) => colorOf(one, bots));
  const nameOf = (one: DailyUsageSeries) => (one.botId ? one.name : t("usage.graph.other", { count: String(one.bots ?? 0) }));
  const tipW = 196;
  const tipLeft = at === null ? 0 : x(at) + 14 + tipW > w ? x(at) - 14 - tipW : x(at) + 14;
  const shown = at === null ? [] : series.map((one, i) => ({ one, i })).filter(({ one }) => (one.values[at] ?? 0) > 0).sort((a, b) => b.one.values[at]! - a.one.values[at]!);

  return (
    <RowsCard label={t("usage.graph.title")} action={action} data-settings-block="usage-graph">
      <div className="px-1 pb-1 pt-2">
        <div
          ref={box}
          data-usage-graph={empty ? "empty" : "data"}
          className="relative rounded-[9px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          tabIndex={empty ? -1 : 0}
          role="group"
          aria-label={empty ? t("usage.graph.empty") : t("usage.graph.label", { amount: amount(report.total) })}
          onPointerMove={pick}
          onPointerLeave={() => setAt(null)}
          onKeyDown={key}
          onBlur={() => setAt(null)}
        >
          <svg width={w} height={H} className="block" aria-hidden="true">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={w - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-ink/[0.07]" strokeDasharray={tick === 0 ? undefined : "2 3"} />
                {!empty && <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-ink-tertiary text-[11px] tabular-nums">{tick === 0 ? "0" : amount(tick)}</text>}
              </g>
            ))}
            {days.map((day, i) => (i % every === 0 || i === days.length - 1) && (i === days.length - 1 || days.length - 1 - i >= every) ? (
              <text key={day} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} className="fill-ink-tertiary text-[11px]">
                {i === days.length - 1 ? t("usage.graph.today") : shortDay(day)}
              </text>
            ) : null)}
            <motion.g initial={reduce ? false : { clipPath: "inset(0% 100% 0% 0%)" }} animate={{ clipPath: "inset(0% 0% 0% 0%)" }} transition={{ duration: 0.5, ease: EASE.out }}>
              {[...series].reverse().map((one) => {
                const i = series.indexOf(one);
                const points = one.values.map((value, j) => [x(j), y(value)] as const);
                const line = smoothPath(points);
                const area = `${line}L${x(days.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
                return (
                  <g key={one.key} data-usage-series={one.key}>
                    <path d={area} fill={colors[i]} opacity={i === 0 ? 0.14 : 0.05} />
                    <path d={line} fill="none" stroke={colors[i]} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                );
              })}
            </motion.g>
            {at !== null && (
              <g>
                <line x1={x(at)} x2={x(at)} y1={PAD.top} y2={PAD.top + ih} className="stroke-ink/20" />
                {series.map((one, i) => <circle key={one.key} cx={x(at)} cy={y(one.values[at] ?? 0)} r={3.5} fill={colors[i]} className="stroke-composer" strokeWidth={2} />)}
              </g>
            )}
          </svg>
          {empty && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 m-0 -translate-y-1/2 px-6 text-center text-[13px] leading-[18px] text-ink-secondary">{t("usage.graph.empty")}</p>
          )}
          <p className="sr-only" aria-live="polite">
            {at !== null ? `${longDay(days[at]!)}: ${t("usage.graph.dayTotal", { amount: amount(report.totals[at] ?? 0) })}. ${shown.map(({ one }) => `${nameOf(one)} ${amount(one.values[at] ?? 0)}`).join(", ")}` : ""}
          </p>
          {at !== null && (
            <div aria-hidden="true" data-usage-tip="" className="pointer-events-none absolute top-0 z-10 rounded-[10px] bg-menu px-2.5 py-2 text-[12px] leading-4 shadow-[0_10px_28px_-10px_rgb(0_0_0/0.28)]"
              style={{ left: tipLeft, width: tipW }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-ink-secondary">{longDay(days[at]!)}</span>
                <span className="tabular-nums text-ink">{amount(report.totals[at] ?? 0)}</span>
              </div>
              {shown.length === 0 && <div className="mt-1.5 text-ink-tertiary">{t("usage.graph.quiet")}</div>}
              {shown.slice(0, 6).map(({ one, i }) => (
                <div key={one.key} className="mt-1.5 flex items-center gap-2">
                  <SeriesMark bot={one.botId ? bots.find((bot) => bot.id === one.botId) : undefined} color={colors[i]!} />
                  <span className="min-w-0 flex-1 truncate text-ink-secondary">{nameOf(one)}</span>
                  <span className="tabular-nums text-ink">{amount(one.values[at] ?? 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!empty && (
          <ul aria-label={t("usage.graph.legend")} className="m-0 mt-2 flex list-none flex-wrap gap-x-4 gap-y-1.5 px-2 pb-1">
            {series.map((one, i) => (
              <li key={one.key} className={cn("flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-secondary")}>
                <SeriesMark bot={one.botId ? bots.find((bot) => bot.id === one.botId) : undefined} color={colors[i]!} />
                <span className="max-w-[10rem] truncate">{nameOf(one)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </RowsCard>
  );
}
