import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cx, Segmented } from "../ui/kit";
import { AnimatePresence, m, SwapText, useReducedMotion, useSlots } from "../ui/motion";
import { Figure } from "../ui/Figure";
import { Link } from "../lib/router";
import { useAdmin } from "./api";
import { countryName } from "./geo";
import { pointsAt, type LiveAnswer } from "./Live";
import { CHANNEL, Morph, NO_VISIT, Row, bar, gridFracs, niceMax, percent, usd, type Note, type RankRow, type SeriesData } from "./kit";
import { n } from "./ui";

const Globe = lazy(() => import("./globe/Globe"));
const DAY = 86_400_000;

export interface Insights { previousVisitors: number[]; visitors: { new: number[]; returning: number[] }; hours: number[][] }
export interface ChartShow { visitors: boolean; main: boolean; signups: boolean }
/** the bars under the visitors line: revenue as new and renewal money, or one figure per bucket (`values`, null when it
 *  cannot be told for this view) in cents, a count or a share */
export interface MainSeries { label: string; kind: "revenue" | "money" | "count" | "share"; values: number[] | null }
/** the series colours; the KPI checkboxes use the same ones */
export const SERIES = { visitors: "var(--viz-visitors)", revenue: "var(--viz-new)", renewal: "var(--viz-renewal)", signups: "var(--coral)" } as const;
const SPRING = { type: "spring", visualDuration: 0.36, bounce: 0 } as const;

export function useWidth(min = 260) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(min, Math.round(el.getBoundingClientRect().width)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [min]);
  return [ref, width] as const;
}
const dayLabel = (t: number, hourly: boolean) => hourly ? new Date(t).toLocaleTimeString("en-US", { hour: "numeric" }).toLowerCase().replace(" ", "") : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
const longLabel = (t: number, hourly: boolean) => hourly ? dayLabel(t, true) : new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toLowerCase();

/** one card around a small chart, like the rest of the admin: a title row and a white panel */
export function ChartCard({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx("flex min-w-0 flex-col rounded-[24px] bg-card p-2", className)}>
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <h2 id={id} className="text-14 font-medium text-ink">{title}</h2>
        {action}
      </div>
      <div className="flex-1 rounded-[18px] bg-pop p-3">{children}</div>
    </section>
  );
}

const SAMPLES = 160;
/** a smooth line through the points as a fixed number of short segments (Catmull-Rom, sampled evenly across the width),
 * so a line of 7 days can morph straight into one of 30 */
export function sampled(points: Array<[number, number]>, floor: number, x0: number, x1: number) {
  if (!points.length) return `M${x0},${floor}` + `L${x1},${floor}`.repeat(SAMPLES - 1);
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]![1];
  let d = "";
  for (let k = 0; k < SAMPLES; k++) {
    const x = x0 + ((x1 - x0) * k) / (SAMPLES - 1);
    const first = points[0]![0], step = points.length > 1 ? points[1]![0] - first : 1;
    const pos = Math.max(0, Math.min(points.length - 1, (x - first) / step)), i = Math.min(points.length - 2, Math.floor(pos)), t = points.length > 1 ? pos - i : 0;
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const y = points.length < 2 ? p1 : 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    d += `${k ? "L" : "M"}${x.toFixed(1)},${Math.min(floor, y).toFixed(1)}`;
  }
  return d;
}

const H = 300, PAD = { top: 16, right: 56, bottom: 28, left: 44 };
/** the main chart, like datafast: visitors as a line over money as bars, each on its own axis, signups as coral dots on the
 * line, the window before as a faint dashed line, notes on the baseline, and a tooltip with what each day earned per visitor */
export function MainChart({ data, previous, notes, show, main, onNote, emptyMoney }: { data: SeriesData; previous: number[]; notes: Note[]; show: ChartShow; main: MainSeries | null; onNote(note: Note | { at: number }): void; emptyMoney?: string | null }) {
  const [box, width] = useWidth(280);
  const [hover, setHover] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, "");
  const reduced = useReducedMotion() ?? false;
  const count = data.starts.length, hourly = data.size < DAY;
  const money = data.revenue ?? { new: data.starts.map(() => 0), renewal: data.starts.map(() => 0), refund: data.starts.map(() => 0) };
  const inner = width - PAD.left - PAD.right, step = inner / Math.max(1, count), base = H - PAD.bottom, top = PAD.top, tall = base - top;
  const x = (i: number) => PAD.left + step * (i + 0.5);
  const vMax = niceMax(Math.max(1, ...data.visitors, ...(show.visitors ? previous : [])));
  const yV = (v: number) => base - (v / vMax) * tall;
  const up = money.new.map((v, i) => v + money.renewal[i]!);
  const bars = show.main && main !== null, stacked = main?.kind === "revenue";
  const single = main?.values ?? data.starts.map(() => 0);
  const peak = Math.max(0, ...(stacked ? up : single));
  const rMax = main?.kind === "count" ? niceMax(Math.max(1, peak)) : main?.kind === "share" ? niceMax(Math.max(0.001, peak) * 1000) / 1000 : niceMax(Math.max(1, peak) / 100) * 100;
  const fmtMain = (v: number) => main?.kind === "count" ? n(Math.round(v)) : main?.kind === "share" ? percent(v) : usd(Math.round(v), true);
  const yR = (cents: number) => base - (cents / rMax) * tall * 0.86;
  const span: [number, number] = [x(0), x(Math.max(0, count - 1))];
  const line = sampled(data.visitors.map((v, i) => [x(i), yV(v)]), base, ...span), flat = sampled([], base, ...span);
  const prevLine = sampled(previous.map((v, i) => [x(i), yV(v)]), base, ...span);
  const area = (path: string) => `${path}L${span[1].toFixed(1)},${base}L${span[0].toFixed(1)},${base}Z`;
  const net = (i: number) => up[i]! + money.refund[i]!;
  const ticks = useMemo(() => { const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(inner / 84)))); return data.starts.map((_, i) => i % every === 0 ? i : -1).filter((i) => i >= 0); }, [count, inner, data.starts]);
  const noteIndex = (at: number) => Math.min(count - 1, Math.max(0, Math.floor((at - data.starts[0]!) / data.size)));
  const visibleNotes = notes.filter((note) => count && note.at >= data.starts[0]! && note.at < data.starts[count - 1]! + data.size);
  const bw = Math.max(2, Math.min(22, step * 0.62));
  const stagger = (i: number) => reduced ? 0 : Math.min(0.2, (i / Math.max(1, count)) * 0.2);
  const totals = { visitors: data.visitors.reduce((a, b) => a + b, 0), revenue: up.reduce((a, b) => a + b, 0) + money.refund.reduce((a, b) => a + b, 0), signups: data.signups.reduce((a, b) => a + b, 0) };
  const empty = stacked ? totals.revenue === 0 : !main?.values || main.values.every((v) => v === 0);
  const extra = main && !stacked ? main : null;
  const at = hover;
  const draw = reduced ? { duration: 0 } : { d: SPRING, pathLength: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const } };
  return (
    <div className="relative" ref={box}>
      <svg width="100%" height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={`chart: ${n(totals.visitors)} visitors, ${usd(totals.revenue)} revenue, ${n(totals.signups)} signups${extra?.values?.length ? `, ${extra.label} ${fmtMain(extra.values.at(-1)!)} at the end` : ""}`}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - PAD.left) / step); setHover(i >= 0 && i < count ? i : null); }} onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--viz-visitors)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--viz-visitors-wash)" stopOpacity={0.4} /></linearGradient></defs>
        {gridFracs(vMax).map((f) => <g key={f}>
          <line x1={PAD.left} x2={width - PAD.right} y1={base - tall * f} y2={base - tall * f} stroke="var(--line)" strokeDasharray={f ? "3 5" : undefined} />
          {show.visitors && <text x={PAD.left - 8} y={base - tall * f + 4} textAnchor="end" className="fill-ink-4 font-mono text-[11px]">{n(Math.round(vMax * f))}</text>}
        </g>)}
        {bars && [0.5, 1].map((f) => <text key={f} x={width - PAD.right + 8} y={yR(rMax * f) + 4} className="fill-money font-mono text-[11px]">{fmtMain(rMax * f)}</text>)}
        <g>
          {bars && data.starts.map((_, i) => {
            const left = x(i) - bw / 2, mid = yR(money.new[i]!), gap = money.new[i]! > 0 && money.renewal[i]! > 0 ? 2 : 0, fade = hover === null || hover === i ? 0.92 : 0.45;
            if (!stacked) return <g key={i} opacity={fade}><Morph d={bar(left, base, yR(single[i] ?? 0), bw)} flat={bar(left, base, base, bw)} fill={SERIES.revenue} delay={stagger(i)} reduced={reduced} /></g>;
            return <g key={i} opacity={fade}>
              <Morph d={bar(left, base, mid, bw)} flat={bar(left, base, base, bw)} fill={SERIES.revenue} delay={stagger(i)} reduced={reduced} />
              <Morph d={bar(left, mid - gap, Math.min(mid - gap, yR(up[i]!) - gap), bw)} flat={bar(left, base, base, bw)} fill={SERIES.renewal} delay={stagger(i)} reduced={reduced} />
            </g>;
          })}
          {show.visitors && <>
            <Morph d={area(line)} flat={area(flat)} fill={`url(#${gradient})`} reduced={reduced} />
            <m.path fill="none" stroke="var(--ink-4)" strokeOpacity={0.55} strokeWidth={1.5} strokeDasharray="4 5" initial={reduced ? { d: prevLine } : { d: prevLine, opacity: 0 }} animate={{ d: prevLine, opacity: 1 }} transition={reduced ? { duration: 0 } : { d: SPRING, opacity: { duration: 0.5, delay: 0.3 } }} />
            <m.path fill="none" stroke={SERIES.visitors} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" initial={reduced ? { d: line } : { d: line, pathLength: 0 }} animate={{ d: line, pathLength: 1 }} transition={draw} />
          </>}
          {show.signups && data.signups.map((s, i) => s > 0 && (
            <m.circle key={`s${i}`} cx={x(i)} cy={show.visitors ? yV(data.visitors[i]!) : base - 8} fill={SERIES.signups} stroke="var(--pop)" strokeWidth={2}
              initial={reduced ? false : { r: 0 }} animate={{ r: 3.5 + Math.min(4, s), opacity: hover === null || hover === i ? 1 : 0.5 }} transition={{ r: { ...SPRING, delay: reduced ? 0 : 0.35 + stagger(i) }, opacity: { duration: 0.15 } }} />
          ))}
        </g>
        {at !== null && <line x1={x(at)} x2={x(at)} y1={top} y2={base} stroke="var(--line-2)" />}
        {at !== null && show.visitors && <circle cx={x(at)} cy={yV(data.visitors[at]!)} r={4.5} fill="var(--pop)" stroke={SERIES.visitors} strokeWidth={2} />}
        {ticks.map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-ink-4 font-mono text-[11px]">{dayLabel(data.starts[i]!, hourly)}</text>)}
      </svg>
      {bars && emptyMoney && empty &&<p className="pointer-events-none absolute right-16 top-2 rounded-full bg-wash-lime px-2.5 py-1 text-12 text-ink-2">{emptyMoney}</p>}
      <div className="absolute inset-x-0" style={{ top: base - 12 }} aria-label="chart notes">
        {visibleNotes.map((note) => (
          <button key={note.id} type="button" onClick={() => onNote(note)} title={note.text} aria-label={`note: ${note.text}. edit`} className="group absolute grid size-6 -translate-x-1/2 place-items-center" style={{ left: x(noteIndex(note.at)) }}>
            <span className="block size-[9px] rotate-45 rounded-[2px] bg-warn" aria-hidden />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-pop px-2.5 py-1 text-12 text-ink group-hover:block group-focus-visible:block" style={{ boxShadow: "var(--pop-shadow)" }}>{note.text}</span>
          </button>
        ))}
      </div>
      <AnimatePresence>
        {at !== null && (() => {
          const v = data.visitors[at]!, rev = net(at), prev = previous[at] ?? 0;
          return (
            <m.div key="tip" className="pointer-events-none absolute left-0 top-2 z-10 min-w-[200px] rounded-[16px] bg-pop px-3.5 py-2.5 text-13 text-ink" style={{ boxShadow: "var(--pop-shadow)" }}
              initial={{ opacity: 0, x: Math.min(x(at) + 16, width - 216) }} animate={{ opacity: 1, x: Math.min(x(at) + 16, width - 216) }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ x: { type: "spring", visualDuration: 0.18, bounce: 0 }, opacity: { duration: 0.12 } }}>
              <div className="font-mono text-12 text-ink-3">{longLabel(data.starts[at]!, hourly)}</div>
              <Row dot={SERIES.visitors} label="visitors" value={n(v)} />
              <Row label="window before" value={n(prev)} />
              {extra && <Row dot={bars ? SERIES.revenue : undefined} label={extra.label} value={extra.values ? fmtMain(extra.values[at] ?? 0) : "-"} strong />}
              <Row dot={stacked && bars ? SERIES.revenue : undefined} label="revenue" value={usd(rev)} strong={!extra} />
              {extra?.label !== "per visitor" && <Row label="per visitor" value={v ? usd(Math.round(rev / v)) : "-"} />}
              <Row dot={SERIES.signups} label="signups" value={n(data.signups[at]!)} />
              {extra?.label !== "conversion" && <Row label="conversion" value={v ? percent(data.signups[at]! / v) : "-"} />}
              {extra?.label !== "new customers" && data.paid[at]! > 0 && <Row label="new customers" value={n(data.paid[at]!)} />}
              {visibleNotes.filter((note) => noteIndex(note.at) === at).map((note) => <div key={note.id} className="mt-1.5 rounded-[10px] bg-wash-lemon px-2 py-1 text-12 text-ink-2">{note.text}</div>)}
            </m.div>
          );
        })()}
      </AnimatePresence>
      {/* a table ignores overflow, so the sr-only box wraps it or it widens the page on phones */}
      <div className="sr-only"><table>
        <caption>visitors, revenue and signups per {hourly ? "hour" : "day"}</caption>
        <thead><tr><th scope="col">{hourly ? "hour" : "day"}</th><th scope="col">visitors</th><th scope="col">window before</th><th scope="col">revenue</th><th scope="col">signups</th>{extra && <th scope="col">{extra.label}</th>}</tr></thead>
        <tbody>{data.starts.map((t, i) => <tr key={t}><th scope="row">{longLabel(t, hourly)}</th><td>{data.visitors[i]}</td><td>{previous[i] ?? 0}</td><td>{usd(net(i))}</td><td>{data.signups[i]}</td>{extra && <td>{extra.values ? fmtMain(extra.values[i] ?? 0) : "-"}</td>}</tr>)}</tbody>
      </table></div>
    </div>
  );
}

/** a palette for categories from the chart tokens; whatever comes after the last one shares a grey */
const CATEGORY = ["var(--viz-visitors)", "var(--viz-new)", "var(--viz-renewal)", "var(--coral)", "var(--viz-refund)", "var(--heat-2)"];
export interface Stack { key: string; label: string; color: string; values: number[] }

/** stacked bars over the chart's buckets; same-shaped data morphs, and a hover lists every layer */
export function StackedBars({ starts, size, stacks, format, height = 168, label }: { starts: number[]; size: number; stacks: Stack[]; format(v: number): string; height?: number; label?(t: number, long: boolean): string }) {
  const [box, width] = useWidth(220);
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion() ?? false;
  const pad = { top: 10, right: 6, bottom: 22, left: 40 };
  const count = starts.length, hourly = size < DAY, inner = width - pad.left - pad.right, step = inner / Math.max(1, count), base = height - pad.bottom;
  const totals = starts.map((_, i) => stacks.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  const y = (v: number) => base - (v / max) * (base - pad.top);
  const bw = Math.max(2, Math.min(16, step * 0.6));
  const x = (i: number) => pad.left + step * (i + 0.5);
  const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(inner / 70))));
  return (
    <div className="relative" ref={box}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left - pad.left) / step); setHover(i >= 0 && i < count ? i : null); }} onMouseLeave={() => setHover(null)}>
        {gridFracs(max, 2).map((f) => <g key={f}><line x1={pad.left} x2={width - pad.right} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" strokeDasharray={f ? "3 5" : undefined} /><text x={pad.left - 6} y={y(max * f) + 4} textAnchor="end" className="fill-ink-4 font-mono text-[10.5px]">{format(Math.round(max * f))}</text></g>)}
        <g>
          {starts.map((_, i) => {
            let at = 0;
            return <g key={i} opacity={hover === null || hover === i ? 1 : 0.45}>{stacks.map((s) => {
              const v = Math.max(0, s.values[i] ?? 0), y0 = y(at), y1 = y(at + v);
              at += v;
              return <Morph key={s.key} d={bar(x(i) - bw / 2, y0, y1, bw)} flat={bar(x(i) - bw / 2, base, base, bw)} fill={s.color} delay={reduced ? 0 : Math.min(0.15, i * 0.006)} reduced={reduced} />;
            })}</g>;
          })}
        </g>
        {starts.map((t, i) => i % every === 0 && <text key={t} x={x(i)} y={height - 6} textAnchor="middle" className="fill-ink-4 font-mono text-[10.5px]">{label ? label(t, false) : dayLabel(t, hourly)}</text>)}
      </svg>
      <AnimatePresence>
        {hover !== null && (
          <m.div key="tip" className="pointer-events-none absolute left-0 top-0 z-10 min-w-[170px] rounded-[14px] bg-pop px-3 py-2 text-12 text-ink" style={{ boxShadow: "var(--pop-shadow)" }}
            initial={{ opacity: 0, x: Math.min(x(hover) + 12, width - 180) }} animate={{ opacity: 1, x: Math.min(x(hover) + 12, width - 180) }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ x: { type: "spring", visualDuration: 0.18, bounce: 0 }, opacity: { duration: 0.12 } }}>
            <div className="font-mono text-ink-3">{label ? label(starts[hover]!, true) : longLabel(starts[hover]!, hourly)}</div>
            {stacks.filter((s) => (s.values[hover] ?? 0) !== 0).map((s) => <Row key={s.key} dot={s.color} label={s.label} value={format(s.values[hover]!)} />)}
            <Row label="total" value={format(totals[hover]!)} strong />
          </m.div>
        )}
      </AnimatePresence>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-12 text-ink-3" aria-label="legend">
        {stacks.map((s) => <li key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />{s.label}</li>)}
      </ul>
      <div className="sr-only"><table><tbody>{starts.map((t, i) => <tr key={t}><th scope="row">{label ? label(t, true) : longLabel(t, hourly)}</th>{stacks.map((s) => <td key={s.key}>{s.label} {format(s.values[i] ?? 0)}</td>)}</tr>)}</tbody></table></div>
    </div>
  );
}

export function channelStacks(byChannel: Record<string, number[]> | undefined): Stack[] {
  const list = Object.entries(byChannel ?? {}).map(([key, values]) => ({ key, values, total: values.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => Number(a.key === NO_VISIT) - Number(b.key === NO_VISIT) || b.total - a.total);
  return list.map((row, i) => ({ key: row.key, label: CHANNEL[row.key] ?? row.key, values: row.values, color: row.key === NO_VISIT ? "var(--ink-4)" : CATEGORY[i % CATEGORY.length]! }));
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HEAT = ["var(--cell)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];
/** visits by weekday and hour in this browser's time zone; the busiest hour is named in words */
export function PeakHours({ grid }: { grid: number[][] }) {
  const max = Math.max(0, ...grid.flat());
  const level = (v: number) => v === 0 || max === 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999));
  let best = { d: 0, h: 0, v: 0 };
  grid.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
  const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
  return (
    <div>
      <div className="grid grid-cols-[28px_repeat(24,minmax(0,1fr))] gap-[3px]" role="img" aria-label={max ? `busiest: ${DAYS[best.d]} around ${hour(best.h)}, ${best.v} visits` : "no visits yet"}>
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <span className="self-center text-[10.5px] text-ink-4">{DAYS[d]}</span>
            {row.map((v, h) => <span key={h} title={`${DAYS[d]} ${hour(h)}: ${n(v)} visits`} className="aspect-square rounded-[4px] transition-[background-color] duration-300" style={{ background: HEAT[level(v)] }} />)}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center text-[10px] text-ink-4">{h % 6 === 0 ? hour(h) : ""}</span>)}
      </div>
      <p className="mt-3 text-13 text-ink-2">{max ? <>busiest around <span className="font-medium text-ink">{DAYS[best.d]} {hour(best.h)}</span>, your time.</> : "no visits in this window yet."}</p>
    </div>
  );
}

/** a row of a little ranked list: a soft bar under the label, its number on the right, animating from its last value */
export function BarRow({ label, value, share, color = "bg-wash-sky", note, muted }: { label: string; value: string; share: number; color?: string; note?: string; muted?: boolean }) {
  return (
    <m.li layout="position" className="relative flex h-9 items-center gap-3 overflow-hidden rounded-[10px] px-2.5 text-13" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ layout: { type: "spring", visualDuration: 0.3, bounce: 0 }, opacity: { duration: 0.18 } }}>
      <m.span className={cx("absolute inset-0", color)} initial={{ clipPath: "inset(0% 100% 0% 0% round 10px)" }} animate={{ clipPath: `inset(0% ${(100 - Math.max(1, share * 100)).toFixed(2)}% 0% 0% round 10px)` }} transition={SPRING} aria-hidden />
      <span className={cx("relative min-w-0 flex-1", muted ? "text-ink-3" : "text-ink")}><SwapText text={label} className="w-full" /></span>
      {note && <span className="relative shrink-0 text-12 font-medium text-ink-3"><SwapText text={note} /></span>}
      <span className="relative w-16 shrink-0 text-end font-mono font-medium text-ink num"><Figure value={value} className="!font-mono !text-13 !leading-5 !tracking-normal" /></span>
    </m.li>
  );
}

/** what a customer is worth by where they first came from, over everything they ever paid */
export function LtvList({ rows }: { rows: Array<{ source: string; customers: number; cents: number; perCustomer: number }> }) {
  if (!rows.length) return <p className="py-6 text-center text-13 text-ink-3">no paying customers yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.perCustomer));
  return <LtvRows rows={rows} max={max} />;
}
function LtvRows({ rows, max }: { rows: Array<{ source: string; customers: number; cents: number; perCustomer: number }>; max: number }) {
  const slots = useSlots(rows.map((r) => r.source));
  return (
    <ul className="flex flex-col gap-px">
      <AnimatePresence initial={false}>
        {rows.map((r, i) => <BarRow key={slots[i]} label={r.source === NO_VISIT ? "no visit recorded" : r.source} muted={r.source === NO_VISIT} value={usd(r.perCustomer, true)} share={r.perCustomer / max} color="bg-wash-lime" note={`${n(r.customers)} ${r.customers === 1 ? "customer" : "customers"}`} />)}
      </AnimatePresence>
    </ul>
  );
}

/** the share of visitors who signed up, by device or by country; places with too few visitors to say are left out */
export function ConversionList({ cards }: { cards: Record<string, RankRow[]> }) {
  const [dim, setDim] = useState<"device" | "country">("device");
  const rows = (cards[dim] ?? []).filter((r) => r.visitors >= 3 && r.key !== "unknown").map((r) => ({ ...r, rate: r.signups / r.visitors })).sort((a, b) => b.rate - a.rate || b.visitors - a.visitors).slice(0, 8);
  const max = Math.max(0.0001, ...rows.map((r) => r.rate));
  const slots = useSlots(rows.map((r) => `${dim}:${r.key}`));
  return (
    <div>
      <div className="mb-2 flex justify-end"><Segmented<"device" | "country"> label="conversion by" value={dim} onChange={setDim} options={[{ value: "device", label: "device" }, { value: "country", label: "country" }]} /></div>
      {rows.length ? (
        <ul className="flex flex-col gap-px">
          <AnimatePresence initial={false} mode="popLayout">
            {rows.map((r, i) => <BarRow key={slots[i]} label={dim === "country" ? countryName(r.key) : r.key} value={percent(r.rate)} share={r.rate / max} color="bg-wash-pink" note={`${n(r.signups)} of ${n(r.visitors)}`} />)}
          </AnimatePresence>
        </ul>
      ) : <p className="py-6 text-center text-13 text-ink-3">not enough visitors to compare yet.</p>}
    </div>
  );
}

/** who is on the site right now, on a small flat map; the full globe is one click away */
export function LiveMap() {
  const { data } = useAdmin<LiveAnswer>("/realtime?minutes=30", 15_000);
  const points = useMemo(() => data ? pointsAt(data.feed, data.now) : [], [data]);
  const online = data ? data.online.site + data.online.app : 0;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 text-13 text-ink-2">
        <span className="inline-flex items-center gap-2"><span className="live-dot text-good" data-live={online > 0} aria-hidden /><Figure value={n(online)} className="!font-mono !text-15 !leading-5 !tracking-normal" /> here now</span>
        <Link to="/admin/live" className="text-link text-12">open the globe</Link>
      </div>
      <Suspense fallback={<div className="aspect-[2/1] w-full rounded-[14px] bg-card" aria-busy="true" />}>
        <Globe points={points} mode="2d" className="!bg-pop" summary={`${points.length} people on the map right now`} />
      </Suspense>
    </div>
  );
}
