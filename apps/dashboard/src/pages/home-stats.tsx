import type { ReactNode } from "react";
import { plural, shortDate } from "../lib/format";
import type { HomeStats, WeekDay } from "../data/week";
import { Figure } from "../ui/Figure";
import { Card, cx } from "../ui/kit";
import { Mascot } from "../ui/Mascot";
import { Spark } from "../ui/Spark";

const MINI_H = 28;
const MAX_PIPS = 14;

/** a made-up shape drawn faintly, so an empty tile shows what kind of line will live there */
function GhostSpark({ shape }: { shape: number[] }) {
  const w = 200, h = MINI_H, top = Math.max(...shape);
  const pts = shape.map((v, i) => `${i ? "L" : "M"}${((i / (shape.length - 1)) * w).toFixed(1)},${(h - 3 - (v / top) * (h - 8)).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: h, width: "100%" }} aria-hidden>
      <path d={`${pts}L${w},${h}L0,${h}Z`} fill="var(--ink)" fillOpacity="0.035" />
      <path d={pts} fill="none" stroke="var(--ink-4)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** one square per thing, so a small count reads at a glance */
function Pips({ items }: { items: string[] }) {
  return (
    <span className="flex h-7 items-end gap-1 overflow-hidden" aria-hidden>
      {items.slice(0, MAX_PIPS).map((tone, i) => <span key={i} className={cx("size-2.5 shrink-0 rounded-[3px]", tone)} />)}
      {items.length > MAX_PIPS && <span className="num ms-0.5 text-12 leading-none text-ink-4">+{items.length - MAX_PIPS}</span>}
    </span>
  );
}

function StatTile({ label, value, foot, mini, i }: { label: string; value: number; foot: string; mini: ReactNode; i: number }) {
  return (
    <li className="surface enter flex min-w-0 flex-col rounded-card bg-card p-5 max-sm:p-4" style={{ ["--i" as string]: i }}>
      <span className="text-13 text-ink-3">{label}</span>
      <span className="mt-1"><Figure value={value.toLocaleString("en-US")} className={value ? undefined : "!text-ink-4"} /></span>
      <span className="mt-auto block pt-4">{mini}</span>
      <span className="mt-2 pt-px text-13 leading-[1.35] text-ink-4 [overflow-wrap:anywhere]">{foot}</span>
    </li>
  );
}

const SHAPES = {
  turns: [2, 3, 2, 5, 4, 7, 6],
  bots: [1, 1, 2, 2, 3, 3, 4],
  routines: [3, 2, 4, 3, 5, 4, 6],
  apps: [1, 2, 2, 3, 3, 4, 5],
};

/** four numbers the account can really report; zero until there is something, with a faint sample of what comes */
export function StatTiles({ stats }: { stats: HomeStats }) {
  const today = stats.days[stats.days.length - 1]?.turns ?? 0;
  return (
    <section aria-labelledby="glance-title">
      <h2 id="glance-title" className="sr-only">at a glance</h2>
      <ul className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:gap-3">
        <StatTile i={2} label="replies this week" value={stats.turns}
          foot={stats.turns ? (today ? `${plural(today, "reply", "replies")} today` : "none yet today") : "fills in as bots reply"}
          mini={stats.turns ? <Spark values={stats.days.map((d) => d.turns)} height={MINI_H} /> : <GhostSpark shape={SHAPES.turns} />} />
        <StatTile i={2.5} label="bots" value={stats.bots}
          foot={stats.bots ? (stats.working ? `${stats.working} working now` : "all quiet") : "make one in the app"}
          mini={stats.bots ? <Pips items={Array.from({ length: stats.bots }, (_, n) => n < stats.working ? "bg-good" : "bg-ink-4/50")} /> : <GhostSpark shape={SHAPES.bots} />} />
        <StatTile i={3} label="routines" value={stats.routines}
          foot={stats.routines ? (stats.pausedRoutines ? `${stats.pausedRoutines} paused` : "all on") : "scheduled bot jobs"}
          mini={stats.routines ? <Pips items={Array.from({ length: stats.routines }, (_, n) => n < stats.routines - stats.pausedRoutines ? "bg-accent" : "bg-track")} /> : <GhostSpark shape={SHAPES.routines} />} />
        <StatTile i={3.5} label="apps connected" value={stats.apps}
          foot={stats.apps ? "your bots can use these" : "gmail, slack and more"}
          mini={stats.apps ? <Pips items={Array.from({ length: stats.apps }, () => "bg-accent")} /> : <GhostSpark shape={SHAPES.apps} />} />
      </ul>
    </section>
  );
}

const GHOST = [30, 48, 38, 64, 52, 80, 44];

function Day({ day, top, ghost, n }: { day: WeekDay; top: number; ghost: boolean; n: number }) {
  const level = day.turns && top ? Math.max(2, Math.ceil((day.turns / top) * 4)) : 0;
  const height = day.turns && top ? Math.max(8, (day.turns / top) * 100) : 0;
  const said = `${day.today ? "today" : day.label}, ${shortDate(day.date)}: ${plural(day.turns, "reply", "replies")}`;
  return (
    <li className="flex min-w-0 flex-col items-center gap-2" aria-label={said} title={said}>
      <span className={cx("num h-4 text-12 leading-4", day.turns ? "text-ink-3" : "text-transparent")} aria-hidden>{day.turns ? day.turns.toLocaleString("en-US") : "0"}</span>
      <span className={cx("relative block h-28 w-full overflow-hidden rounded-[10px] max-sm:h-24", day.today ? "bg-sky" : "bg-cell")} aria-hidden>
        {height > 0 && <span className="absolute inset-x-1.5 bottom-1.5 rounded-[6px]" style={{ height: `calc(${height}% - 12px)`, minHeight: 6, background: `var(--heat-${level})` }} />}
        {ghost && <span className="absolute inset-x-1.5 bottom-1.5 rounded-[6px] border border-dashed border-ink-4/35 bg-ink/[0.03]" style={{ height: `${GHOST[n % GHOST.length]}%` }} />}
      </span>
      <span className={cx("text-12 leading-4", day.today ? "font-medium text-accent-ink" : "text-ink-4")} aria-hidden>{day.today ? "today" : day.label}</span>
    </li>
  );
}

/** seven columns, oldest left, today right; a quiet week shows faint sample bars and a line on what fills them */
export function WeekStrip({ stats }: { stats: HomeStats }) {
  const top = Math.max(0, ...stats.days.map((d) => d.turns));
  const empty = top === 0;
  return (
    <Card className="enter" style={{ ["--i" as string]: 4 }} aria-labelledby="week-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-title" className="text-16 font-medium tracking-[-0.02em] text-ink">this week</h2>
        <span className="num text-13 text-ink-3">{plural(stats.turns, "reply", "replies")}</span>
      </div>
      <ol className="mt-5 grid grid-cols-7 gap-2 max-sm:gap-1.5" aria-label="replies per day">
        {stats.days.map((day, n) => <Day key={day.key} day={day} top={top} ghost={empty} n={n} />)}
      </ol>
      {empty && <div className="mt-5 flex items-center gap-3">
        <span className="shrink-0" aria-hidden><Mascot body="pip" color="green" size={28} state="sleeping" tappable /></span>
        <p className="text-14 text-ink-3">your week shows up here. each day fills in as your bots reply.</p>
      </div>}
    </Card>
  );
}

const ROWS = [{ name: "w-24", line: "w-40", when: "w-12" }, { name: "w-16", line: "w-52", when: "w-10" }, { name: "w-20", line: "w-32", when: "w-14" }];

/** what "who ran last" will look like, before any bot has run */
export function RecentEmpty() {
  return (
    <Card className="enter !p-3" style={{ ["--i" as string]: 7 }} aria-labelledby="recent-empty-title">
      <h2 id="recent-empty-title" className="px-3 pb-1 pt-2 text-16 font-medium tracking-[-0.02em] text-ink">who ran last</h2>
      <ul className="px-3" aria-hidden>
        {ROWS.map((row, i) => (
          <li key={i} className="flex items-center gap-3 py-3" style={{ opacity: 1 - i * 0.25 }}>
            <span className="size-[30px] shrink-0 rounded-[9px] bg-card-2" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={cx("h-2.5 max-w-full rounded-full bg-card-2", row.name)} />
              <span className={cx("h-2 max-w-full rounded-full bg-card-2/70", row.line)} />
            </span>
            <span className={cx("h-2.5 shrink-0 rounded-full bg-card-2", row.when)} />
          </li>
        ))}
      </ul>
      <p className="px-3 pb-2 pt-1 text-14 text-ink-3">your bots' latest runs land here.</p>
    </Card>
  );
}
