import { useEffect, useId, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { ease, spring } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { formatFigure, parseFigure } from "../../../../apps/dashboard/src/ui/Figure";
import { SPRING as DASH_SPRING } from "../../../../apps/dashboard/src/ui/motion";
import { Dash, Drums, RollText, StretchPill, useCount } from "./kit/dash";
import { useDemo } from "./kit/demo";
import { springOf } from "./kit/time";

type Range = "7d" | "30d" | "90d";
const DATA: Record<Range, { visitors: number; signups: number; revenue: number; before: [number, number, number]; line: number[] }> = {
  "7d": { visitors: 1204, signups: 38, revenue: 640, before: [1010, 41, 520], line: [30, 42, 38, 55, 48, 62, 58, 66, 60, 72, 69, 80] },
  "30d": { visitors: 5318, signups: 162, revenue: 2860, before: [4420, 131, 2410], line: [40, 36, 48, 44, 52, 50, 64, 58, 70, 66, 78, 84] },
  "90d": { visitors: 14876, signups: 401, revenue: 7140, before: [15102, 350, 6050], line: [62, 58, 54, 60, 50, 46, 52, 58, 56, 64, 70, 68] },
};
const RANGES: Range[] = ["7d", "30d", "90d"];
const DEMO: Range[] = ["7d", "90d", "30d"];
type Look = "original" | "a" | "b";

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
const delta = (now: number, before: number) => { const c = Math.round(((now - before) / before) * 100); return { text: `${Math.abs(c)}% ${c >= 0 ? "↑" : "↓"}`, up: c >= 0 }; };

/** the dashboard's Figure: counts through the numbers in between, 520ms cubic out */
function Counting({ text, speed, reduced }: { text: string; speed: number; reduced: boolean }) {
  const to = parseFigure(text)!;
  const v = useCount(to.n, speed, reduced);
  return <>{formatFigure(Math.round(v), { ...to, grouped: true })}</>;
}

function Value({ look, text, speed, reduced }: { look: Look; text: string; speed: number; reduced: boolean }) {
  if (look === "original") return <Counting text={text} speed={speed} reduced={reduced} />;
  if (look === "a") return <RollText text={text} distance={6} blur={2} />;
  return <Drums text={text} reduced={reduced} />;
}

function Delta({ look, now, before }: { look: Look; now: number; before: number }) {
  const d = delta(now, before);
  const cls = d.up ? "up" : "down";
  if (look === "original") return <span className={cls}>{d.text}</span>;
  if (look === "a") return <span className={cls}><RollText text={d.text} distance={4} blur={2} /></span>;
  return (
    <motion.span key={d.text} className={cls} style={{ display: "inline-block", transformOrigin: "0 50%" }}
      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring.pop, delay: 0.18 }}>{d.text}</motion.span>
  );
}

const W = 300, H = 120, PAD = 8;
const xAt = (i: number) => PAD + (i * (W - PAD * 2)) / 11;
const yAt = (v: number) => H - PAD - (v / 100) * (H - PAD * 2);
/** catmull-rom through the points, as cubic beziers */
function smooth(ys: number[]) {
  const p = ys.map((y, i) => [xAt(i), y] as const);
  let d = `M${p[0]![0]},${p[0]![1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i]!, p1 = p[i]!, p2 = p[i + 1]!, p3 = p[i + 2] ?? p2;
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}
const areaOf = (line: string) => `${line}L${xAt(11)},${H}L${xAt(0)},${H}Z`;

function Chart({ look, line, reduced, replayKey }: { look: Look; line: number[]; reduced: boolean; replayKey: number }) {
  const grad = `g${useId().replace(/:/g, "")}`;
  const ys = line.map(yAt);
  if (look === "b") return <PointChart ys={ys} grad={grad} reduced={reduced} />;
  const d = smooth(ys);
  const flat = smooth(ys.map(() => H - PAD));
  const morph = look === "original" ? DASH_SPRING : spring.soft;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} key={replayKey} aria-hidden>
      <defs><linearGradient id={grad} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--viz-visitors)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--viz-visitors-wash)" stopOpacity={0.4} /></linearGradient></defs>
      {look === "original"
        ? <motion.path fill={`url(#${grad})`} initial={{ d: areaOf(flat) }} animate={{ d: areaOf(d) }} transition={{ d: { type: "spring", visualDuration: 0.36, bounce: 0 } }} />
        : <motion.path fill={`url(#${grad})`} initial={{ d: areaOf(d), opacity: 0 }} animate={{ d: areaOf(d), opacity: 1 }} transition={{ d: morph, opacity: { duration: 0.2, ease: ease.out } }} />}
      <motion.path fill="none" stroke="var(--viz-visitors)" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round"
        initial={look === "original" && !reduced ? { d, pathLength: 0 } : { d, opacity: 0 }}
        animate={{ d, pathLength: 1, opacity: 1 }}
        transition={look === "original" ? { d: { type: "spring", visualDuration: 0.36, bounce: 0 }, pathLength: { duration: 0.7, ease: ease.out } } : { d: morph, opacity: { duration: 0.2 } }} />
    </svg>
  );
}

/** twelve points, each on its own 200/17 spring, swept left to right 30ms apart; the end dot rides the last one */
function PointChart({ ys, grad, reduced }: { ys: number[]; grad: string; reduced: boolean }) {
  const mvs = [useMotionValue(ys[0]!), useMotionValue(ys[1]!), useMotionValue(ys[2]!), useMotionValue(ys[3]!), useMotionValue(ys[4]!), useMotionValue(ys[5]!),
    useMotionValue(ys[6]!), useMotionValue(ys[7]!), useMotionValue(ys[8]!), useMotionValue(ys[9]!), useMotionValue(ys[10]!), useMotionValue(ys[11]!)];
  const key = ys.join(",");
  useEffect(() => {
    const runs = mvs.map((mv, i) => reduced ? (mv.set(ys[i]!), null) : animate(mv, ys[i]!, springOf(200, 17, i * 0.03)));
    return () => runs.forEach((r) => r?.stop());
  }, [key, reduced]);
  const d = useTransform(mvs as MotionValue<number>[], (v: number[]) => smooth(v));
  const area = useTransform(d, areaOf);
  const last = mvs[11]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden>
      <defs><linearGradient id={grad} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--viz-visitors)" stopOpacity={0.22} /><stop offset="100%" stopColor="var(--viz-visitors-wash)" stopOpacity={0.4} /></linearGradient></defs>
      <motion.path fill={`url(#${grad})`} d={area} />
      <motion.path fill="none" stroke="var(--viz-visitors)" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" d={d} />
      <motion.circle cx={xAt(11)} cy={last} r={4.5} fill="var(--pop)" stroke="var(--viz-visitors)" strokeWidth={2} />
    </svg>
  );
}

function Stats({ look, replayKey, speed, reduced }: LabProps & { look: Look }) {
  const [range, setRange] = useState<Range>("30d");
  const seg = useRef<HTMLDivElement>(null);
  const pill = `rg${useId()}`;
  useDemo(replayKey, speed, DEMO.map((r, i) => [800 + i * 1200, () => setRange(r)]), () => setRange("30d"));
  const d = DATA[range];
  const tiles = useMemo(() => [
    { label: "visitors", text: fmt(d.visitors), now: d.visitors, before: d.before[0] },
    { label: "signups", text: fmt(d.signups), now: d.signups, before: d.before[1] },
    { label: "revenue", text: usd(d.revenue), now: d.revenue, before: d.before[2], money: true },
  ], [d]);
  return (
    <Dash reduced={reduced}>
      <div style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span className="meta">overview</span>
          <div ref={seg} className="seg" role="radiogroup" aria-label="range">
            {look === "b" && <StretchPill box={seg} target={range} reduced={reduced} />}
            {RANGES.map((r) => (
              <button key={r} data-key={r} type="button" role="radio" aria-checked={range === r} className="hov-link" onClick={() => setRange(r)}>
                {look !== "b" && range === r && <motion.span layoutId={pill} className="pill" transition={look === "original" ? DASH_SPRING : spring.fade} />}
                <span>{r}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="kpis">
          {tiles.map((t) => (
            <div key={t.label} className={`kpi ${t.money ? "money" : ""}`}>
              <div className="l">{t.label}</div>
              <div className="v"><Value look={look} text={t.text} speed={speed} reduced={reduced} /></div>
              <div className="d"><Delta look={look} now={t.now} before={t.before} /></div>
            </div>
          ))}
        </div>
        <div className="card" style={{ marginTop: 8, padding: "8px 6px 2px" }}>
          <Chart look={look} line={d.line} reduced={reduced} replayKey={replayKey} />
        </div>
      </div>
    </Dash>
  );
}

export const dashStats: Item = {
  id: "dash-stats",
  title: "stat cards, numbers and the chart",
  surface: "admin overview",
  height: 330,
  loopMs: 4800,
  notes: {
    original: "Figure.tsx: a changed number counts through every value in between, 520ms cubic out; delta swaps instantly. chart: line draws on mount 0.7s, then morphs on spring 0.36s/0.",
    a: "only the digits that changed rise in, 6px with 2px blur, 220ms ease-out, 18ms apart; delta does the same. chart morphs on soft 260/24, no redraw.",
    b: "digit wheels: each column turns on 260/(22+2i), 45ms apart, masked top and bottom (NumberFlow-style, rebuilt). delta pops on 520/26. chart: 12 points each on 200/17, swept 30ms left to right, end dot rides the last (designbookmark stat card, rebuilt).",
  },
  Original: (p) => <Stats look="original" {...p} />,
  A: (p) => <Stats look="a" {...p} />,
  B: (p) => <Stats look="b" {...p} />,
};
