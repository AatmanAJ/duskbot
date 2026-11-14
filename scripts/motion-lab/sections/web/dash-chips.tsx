import { useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Check } from "@/icons";
import { dur, ease, spring } from "@lab/tokens";
import type { Item, LabProps } from "@lab/types";
import { SPRING as DASH_SPRING } from "../../../../apps/dashboard/src/ui/motion";
import { Dash, RollText, StretchPill } from "./kit/dash";
import { useDemo } from "./kit/demo";

type Look = "original" | "a" | "b";
type Key = "relay" | "cost" | "emails";
type Flag = "abuse" | "throttled" | "check";
const SORTS: Array<{ key: Key; label: string }> = [{ key: "relay", label: "relay gb" }, { key: "cost", label: "cloud cost" }, { key: "emails", label: "emails" }];
const FLAGS: Record<Flag, { word: string; wash: string; dot: string }> = {
  abuse: { word: "possible abuse", wash: "var(--wash-pink)", dot: "var(--bad)" },
  throttled: { word: "throttled", wash: "var(--wash-lemon)", dot: "var(--warn)" },
  check: { word: "needs checking", wash: "var(--wash-sky)", dot: "#2f7bf2" },
};
const ROWS = [
  { id: "a1", name: "maya okafor", relay: 41.2, cost: 3.1, emails: 12, flag: "throttled" as Flag },
  { id: "a2", name: "theo lindqvist", relay: 8.4, cost: 9.8, emails: 3, flag: null },
  { id: "a3", name: "inês duarte", relay: 22.9, cost: 1.2, emails: 40, flag: "check" as Flag },
  { id: "a4", name: "account 7f3a91c2", relay: 96.0, cost: 6.4, emails: 0, flag: "abuse" as Flag },
];

function Chips({ look, replayKey, speed, reduced }: LabProps & { look: Look }) {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "relay", desc: true });
  const [flags, setFlags] = useState<Set<Flag>>(new Set());
  const pill = `s${useId()}`;
  const seg = useRef<HTMLDivElement>(null);
  const flip = (f: Flag) => setFlags((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  useDemo(replayKey, speed, [
    [700, () => setSort({ key: "cost", desc: true })],
    [1500, () => setSort({ key: "cost", desc: false })],
    [2300, () => flip("throttled")],
    [3100, () => setSort({ key: "emails", desc: true })],
  ], () => { setSort({ key: "relay", desc: true }); setFlags(new Set()); });
  const rows = ROWS.filter((r) => !flags.size || (r.flag && flags.has(r.flag))).sort((a, b) => (b[sort.key] - a[sort.key]) * (sort.desc ? 1 : -1));
  const order = sort.desc ? "most first" : "least first";
  const arrow = look === "original" ? DASH_SPRING : look === "a" ? { duration: dur.swap, ease: ease.inOut } : spring.pop;
  return (
    <Dash reduced={reduced}>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <div ref={seg} className="seg" role="radiogroup" aria-label="sort by">
            {look === "b" && <StretchPill box={seg} target={sort.key} reduced={reduced} />}
            {SORTS.map((c) => {
              const on = sort.key === c.key;
              return (
                <button key={c.key} data-key={c.key} type="button" role="radio" aria-checked={on} className="hov-link" style={{ paddingInline: "11px 8px" }}
                  onClick={() => setSort((s) => s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: true })}>
                  {look !== "b" && on && <motion.span layoutId={pill} className="pill" transition={look === "original" ? DASH_SPRING : spring.fade} />}
                  <span>{c.label}</span>
                  <span aria-hidden style={{ display: "grid", width: 14, placeItems: "center", opacity: on ? 1 : 0, transition: "opacity 150ms" }}>
                    <motion.span style={{ display: "grid" }} initial={false} animate={{ rotate: on && !sort.desc ? 180 : 0 }} transition={arrow}><ArrowDown size={12} strokeWidth={2} /></motion.span>
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" className="press hov" onClick={() => setSort((s) => ({ ...s, desc: !s.desc }))} aria-label={`order: ${order}`}
            style={{ height: 30, width: 86, borderRadius: 999, fontSize: 12.5, color: "var(--ink-2)", display: "grid", placeItems: "center" }}>
            {look === "original" ? order : <RollText text={order} distance={6} blur={2} />}
          </button>
        </div>
        <div role="group" aria-label="show only" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(Object.keys(FLAGS) as Flag[]).map((f) => <FlagChip key={f} look={look} f={f} on={flags.has(f)} onClick={() => flip(f)} count={ROWS.filter((r) => r.flag === f).length} />)}
        </div>
        <div>
          {rows.map((r) => {
            const body = <><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span><span className="mono num" style={{ fontSize: 13 }}>{sort.key === "relay" ? `${r.relay} gb` : sort.key === "cost" ? `$${r.cost.toFixed(2)}` : r.emails}</span></>;
            return look === "b"
              ? <motion.div layout="position" key={r.id} className="row" style={{ height: 38, marginTop: 4 }} transition={spring.layout}>{body}</motion.div>
              : <div key={r.id} className="row" style={{ height: 38, marginTop: 4 }}>{body}</div>;
          })}
        </div>
      </div>
    </Dash>
  );
}

function FlagChip({ look, f, on, count, onClick }: { look: Look; f: Flag; on: boolean; count: number; onClick(): void }) {
  const flag = FLAGS[f];
  const icon = on ? <Check size={13} strokeWidth={2.25} /> : <span className="dot" style={{ background: flag.dot }} />;
  return (
    <motion.button type="button" aria-pressed={on} onClick={onClick} className={`chip press ${on ? "" : "hov"}`}
      layout={look === "b" ? "size" : false} transition={spring.width}
      style={{ background: on ? flag.wash : "var(--card)", transition: "background-color 150ms ease-out, color 150ms ease-out", borderRadius: 999 }}>
      <span aria-hidden style={{ display: "grid", width: 14, height: 14, placeItems: "center" }}>
        {look === "original" ? icon : look === "a" ? (
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={String(on)} style={{ display: "grid", placeItems: "center" }} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }} transition={{ duration: dur.fast, ease: ease.out }}>{icon}</motion.span>
          </AnimatePresence>
        ) : on ? (
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <motion.path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: dur.draw, ease: ease.inOut }} />
          </svg>
        ) : <motion.span className="dot" style={{ background: flag.dot }} initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring.pop} />}
      </span>
      <motion.span layout={look === "b" ? "position" : false}>{flag.word}</motion.span>
      <span className="mono num" style={{ fontSize: 12, color: on ? "var(--ink-2)" : "var(--ink-4)" }}>{count}</span>
    </motion.button>
  );
}

export const dashChips: Item = {
  id: "ops-chips",
  title: "ops sort and filter chips",
  surface: "admin ops",
  height: 320,
  loopMs: 4200,
  notes: {
    original: "OpsAccounts.tsx: sort pill layoutId on SPRING 0.26s/0.08; arrow turns on the same spring; 'most first' and the flag icon swap instantly; rows re-sort instantly.",
    a: "pill on 420/32; arrow turns 200ms in-out; 'most first' swaps only its changed letters (6px, 2px blur); flag icon crossfades with a .6 scale, 150ms. rows still re-sort instantly (a tool used all day).",
    b: "stretchy pill (620/36 lead, 190/19 trail); arrow on 520/26; a picked flag draws its check (450ms in-out) and the chip resizes on 380/24; rows slide to their new place on the layout spring (0.3s, no bounce).",
  },
  Original: (p) => <Chips look="original" {...p} />,
  A: (p) => <Chips look="a" {...p} />,
  B: (p) => <Chips look="b" {...p} />,
};
