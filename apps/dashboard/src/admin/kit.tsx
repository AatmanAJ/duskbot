import { useId, useState, type ReactNode } from "react";
import { Maximize, Plus, X } from "@/icons";
import { Link } from "../lib/router";
import { Button, cx } from "../ui/kit";
import { Modal } from "../ui/controls";
import { AnimatePresence, m, Pill, SwapText, usePill, useSlots } from "../ui/motion";
import { Figure } from "../ui/Figure";
import { Mascot } from "../ui/Mascot";
import { avatarOf, friendlyName } from "./names";
import { countryName } from "./geo";
import { n } from "./ui";
import { UserFace } from "../ui/UserAvatar";

export type RangeKey = "today" | "7d" | "30d" | "90d" | "custom";
export interface Range { key: RangeKey; from: number; to: number }
const DAY = 86_400_000;
const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export function rangeOf(key: RangeKey, now = Date.now(), custom?: { from: string; to: string }): Range {
  if (key === "custom" && custom) {
    const from = new Date(`${custom.from}T00:00:00`).getTime(), to = new Date(`${custom.to}T00:00:00`).getTime() + DAY;
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) return { key, from, to: Math.min(to, now) };
  }
  const days = key === "7d" ? 7 : key === "30d" ? 30 : key === "90d" ? 90 : 1;
  return { key: key === "custom" ? "30d" : key, from: midnight(now) - (days - 1) * DAY, to: now };
}
const isoDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** today, 7, 30, 90 days, or two dates; changes apply at once */
export function RangePicker({ value, onChange }: { value: Range; onChange(range: Range): void }) {
  const [custom, setCustom] = useState({ from: isoDay(value.from), to: isoDay(value.to - 1) });
  const fromId = useId(), toId = useId();
  const keys: Array<[RangeKey, string]> = [["today", "today"], ["7d", "7 days"], ["30d", "30 days"], ["90d", "90 days"], ["custom", "custom"]];
  const pill = usePill();
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="date range" className="scroll-x inline-flex max-w-full rounded-full bg-card-2 p-1">
        {keys.map(([key, label]) => (
          <button key={key} type="button" role="radio" aria-checked={value.key === key} onClick={() => onChange(rangeOf(key, Date.now(), custom))}
            className={cx("relative h-8 shrink-0 whitespace-nowrap rounded-full px-3.5 text-13", value.key === key ? "text-ink" : "text-ink-3 hover-link")}>{value.key === key && <Pill id={pill} />}<span className="relative">{label}</span></button>
        ))}
      </div>
      <AnimatePresence initial={false}>
      {value.key === "custom" && (
        <m.div key="custom" className="flex items-center gap-1.5" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6, transition: { duration: 0.12 } }}>
          <label htmlFor={fromId} className="sr-only">from</label>
          <input id={fromId} type="date" value={custom.from} max={custom.to} onChange={(e) => { const next = { ...custom, from: e.target.value }; setCustom(next); onChange(rangeOf("custom", Date.now(), next)); }} className="field !h-9 !w-[150px] !px-3 !text-13" />
          <span className="text-13 text-ink-4" aria-hidden>to</span>
          <label htmlFor={toId} className="sr-only">to</label>
          <input id={toId} type="date" value={custom.to} min={custom.from} onChange={(e) => { const next = { ...custom, to: e.target.value }; setCustom(next); onChange(rangeOf("custom", Date.now(), next)); }} className="field !h-9 !w-[150px] !px-3 !text-13" />
        </m.div>
      )}
      </AnimatePresence>
    </div>
  );
}

/** the change against the previous window, in words and an arrow, green up and red down (or the reverse for bounce) */
export function Delta({ now, before, invert = false }: { now: number | null; before: number | null; invert?: boolean }) {
  if (now === null || before === null) return <span className="text-12 text-ink-4">no earlier data</span>;
  if (before === 0) return <span className="text-12 text-ink-4">{now === 0 ? "same as before" : "new"}</span>;
  const change = (now - before) / before, up = change > 0, good = invert ? !up : up;
  if (Math.abs(change) < 0.005) return <span className="text-12 text-ink-4">same as before</span>;
  const size = Math.round(Math.abs(change) * 100);
  return <span className={cx("font-mono text-12 num", good ? "text-good" : "text-bad")} aria-label={`${up ? "up" : "down"} ${size}% on the window before`}>{size > 999 ? "999+" : size}% {up ? "↑" : "↓"}</span>;
}

export const percent = (value: number | null) => value === null ? "-" : `${Math.round(value * 1000) / 10}%`;
export function duration(ms: number | null) {
  if (ms === null) return "-";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.round(h / 24)} days`;
}

/** a person with an account: their face (photo, or the head drawn from their account id), a sky ring for a customer.
 * a visitor without one: their stable mascot and colour, from the hash of their id */
export function Avatar({ seed, size = 32, customer, account }: { seed: string; size?: number; customer?: boolean; account?: { id: string; avatarUrl?: string; avatar?: string } | null }) {
  if (account) return <UserFace account={account} size={size + 8} className={customer ? "ring-2 ring-wash-sky" : undefined} />;
  const { body, ink } = avatarOf(seed);
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-full bg-card", customer && "bg-wash-sky")} style={{ width: size + 8, height: size + 8 }} aria-hidden>
      <Mascot body={body} color={ink} size={size} still />
    </span>
  );
}
export const personName = (seed: string, email?: string | null) => email ?? friendlyName(seed);

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-6 items-center rounded-full bg-card px-2.5 text-12 text-ink-2">{children}</span>;
}
export const where = (country: string | null | undefined, city?: string | null) => country ? `${city ? `${city}, ` : ""}${countryName(country)}` : "unknown place";

export const CHANNEL: Record<string, string> = { direct: "direct", search: "search", social: "social", ai: "ai assistants", referral: "referrals", email: "email", paid: "paid ads", unknown: "unknown", no_visit: "no visit recorded" };
/** revenue credited to no visit at all: paid before tracking began, or on a device the tracker never saw */
export const NO_VISIT = "no_visit";
export interface Note { id: string; at: number; text: string; by: string; createdAt: number }
export interface SeriesData { size: number; starts: number[]; visitors: number[]; signups: number[]; paid: number[]; waitlist: number[]; /** cents per bucket */ revenue?: { new: number[]; renewal: number[]; refund: number[]; /** expected mrr at each bucket's end; null with filters */ mrr?: number[] | null } }

/** dollars from cents: whole dollars when even, one decimal in thousands past $10k */
export function usd(cents: number, compact = false) {
  const sign = cents < 0 ? "-" : "", v = Math.abs(cents) / 100;
  if (compact && v >= 10_000) return `${sign}$${(v / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k`;
  return `${sign}$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** gridline fractions whose labels land on whole numbers: quarters, else halves, else just the ends */
export function gridFracs(max: number, most = 4) {
  if (most >= 4 && Number.isInteger(max / 4)) return [0, 0.25, 0.5, 0.75, 1];
  return Number.isInteger(max / 2) ? [0, 0.5, 1] : [0, 1];
}
export function niceMax(value: number) { if (value <= 4) return 4; const p = 10 ** Math.floor(Math.log10(value)); const m = value / p; return ([1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => m <= step) ?? 10) * p; }
/** a bar with its data end rounded and its baseline end square; a zero bar keeps the same commands, flat on the baseline */
export function bar(x: number, y0: number, y1: number, w: number) {
  const up = y1 <= y0, h = Math.abs(y1 - y0), r = Math.min(3, h, w / 2), f = (v: number) => v.toFixed(1);
  return up ? `M${f(x)},${f(y0)}V${f(y1 + r)}Q${f(x)},${f(y1)} ${f(x + r)},${f(y1)}H${f(x + w - r)}Q${f(x + w)},${f(y1)} ${f(x + w)},${f(y1 + r)}V${f(y0)}Z`
    : `M${f(x)},${f(y0)}V${f(y1 - r)}Q${f(x)},${f(y1)} ${f(x + r)},${f(y1)}H${f(x + w - r)}Q${f(x + w)},${f(y1)} ${f(x + w)},${f(y1 - r)}V${f(y0)}Z`;
}

/** a mark that grows out of its flat self on mount and morphs to each new shape after */
export function Morph({ d, flat, fill, delay = 0, reduced, ...rest }: { d: string; flat: string; fill: string; delay?: number; reduced: boolean } & React.SVGProps<SVGPathElement>) {
  return <m.path {...(rest as object)} fill={fill} initial={{ d: reduced ? d : flat }} animate={{ d }} transition={reduced ? { duration: 0 } : { type: "spring", visualDuration: 0.36, bounce: 0, delay }} />;
}

export interface Mark { at: number; kind: "signup" | "paid"; seed: string; email: string | null; customer?: boolean }
export function Row({ label, value, dot, strong }: { label: string; value: string; dot?: string; strong?: boolean }) {
  return <div className="mt-0.5 flex items-center justify-between gap-4"><span className="inline-flex items-center gap-1.5 text-ink-2">{dot && <span className="size-2 rounded-[2px]" style={{ background: dot }} aria-hidden />}{label}</span><span className={cx("font-mono num", strong && "font-medium")}>{value}</span></div>;
}

/** add or edit a chart note; deleting is here too */
export function NoteDialog({ note, onClose, onSave, onDelete }: { note: Note | { at: number } | null; onClose(): void; onSave(input: { at: number; text: string }): Promise<void>; onDelete(id: string): Promise<void> }) {
  const editing = note && "id" in note ? note : null;
  const [text, setText] = useState(editing?.text ?? "");
  const [day, setDay] = useState(note ? isoDay(note.at) : isoDay(Date.now()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const textId = useId(), dayId = useId();
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); onClose(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } };
  return (
    <Modal open={note !== null} onClose={onClose} title={editing ? "edit note" : "add a note to the chart"}
      footer={<>
        {editing && <Button variant="danger" disabled={busy} onClick={() => void run(() => onDelete(editing.id))} className="me-auto">delete</Button>}
        <Button variant="ghost" onClick={onClose} disabled={busy}>cancel</Button>
        <Button variant="primary" disabled={busy || !text.trim() || text.length > 140} onClick={() => void run(() => onSave({ at: new Date(`${day}T12:00:00`).getTime(), text: text.trim() }))}>{editing ? "save" : "add note"}</Button>
      </>}>
      <p>a short line, like "launch post" or "pricing page v2".</p>
      <label htmlFor={textId} className="mt-4 block text-13 text-ink-2">note</label>
      <input id={textId} value={text} maxLength={140} onChange={(e) => setText(e.target.value)} className="field mt-1.5" aria-invalid={error ? true : undefined} />
      <label htmlFor={dayId} className="mt-3 block text-13 text-ink-2">day</label>
      <input id={dayId} type="date" value={day} onChange={(e) => setDay(e.target.value)} className="field mt-1.5" />
      {error && <p role="alert" className="mt-2 text-13 text-bad">{error}</p>}
    </Modal>
  );
}

export interface RankRow { key: string; visitors: number; signups: number; paid: number }
/** a tabbed ranked card: visitors as a light bar, the signups they became as a darker bar on top; a row filters the page */
export function RankCard({ title, tabs, data, label, onPick, active, metric, details, panels, rows: limit = 8, money }: { title: string; tabs: Array<{ id: string; label: string; icon?: ReactNode }>; data: Record<string, RankRow[]>; label?(tab: string, key: string): ReactNode; onPick?(tab: string, key: string): void; active?: Record<string, string | undefined>; /** a single count instead of visitors and signups */ metric?: string;
  /** the full-page view of a tab, when it has one */ details?(tab: string): string | null; /** a tab drawn its own way, like a map */ panels?: Record<string, ReactNode>; rows?: number;
  /** revenue in cents per tab and row key, credited to where each payer came from */ money?: Record<string, Record<string, number>> }) {
  const [tab, setTab] = useState(tabs[0]!.id);
  const [all, setAll] = useState(false);
  const [byMoney, setByMoney] = useState(false);
  const tabPill = usePill(), sortPill = usePill();
  const cents = money?.[tab] ?? {};
  const earned = Object.values(cents).some((v) => v !== 0);
  const listed = data[tab] ?? [];
  const extra = Object.keys(cents).filter((key) => !listed.some((row) => row.key === key)).map((key) => ({ key, visitors: 0, signups: 0, paid: 0 }));
  // money with no visit behind it goes last whichever way the rows are sorted
  const last = (row: RankRow) => Number(row.key === NO_VISIT || row.visitors === 0);
  const rows = [...listed, ...extra].sort((a, b) => last(a) - last(b) || (byMoney && earned ? (cents[b.key] ?? 0) - (cents[a.key] ?? 0) || b.visitors - a.visitors : 0));
  const max = Math.max(1, ...rows.map((row) => row.visitors));
  const moneyMax = Math.max(1, ...Object.values(cents));
  const shown = all ? rows : rows.slice(0, limit);
  const slots = useSlots(shown.map((row) => row.key));
  const more = details?.(tab);
  const moneyCol = Boolean(money);
  return (
    <section className="flex min-w-0 flex-col rounded-[24px] bg-card p-2" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1.5 pt-1">
        <div role="tablist" aria-label={title} className="scroll-x flex max-w-full gap-0.5">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setAll(false); }}
              className={cx("relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-13", tab === t.id ? "font-medium text-ink" : "text-ink-3 hover-link")}>{tab === t.id && <Pill id={tabPill} />}{t.icon && <span aria-hidden className="relative opacity-70">{t.icon}</span>}<span className="relative">{t.label}</span></button>
          ))}
        </div>
        {money ? (
          <div role="radiogroup" aria-label="sort rows by" className="inline-flex shrink-0 rounded-full bg-card-2 p-0.5">
            {([[false, "visitors"], [true, "revenue"]] as const).map(([value, text]) => (
              <button key={text} type="button" role="radio" aria-checked={byMoney === value} onClick={() => setByMoney(value)}
                className={cx("relative h-7 rounded-full px-2.5 text-12", byMoney === value ? "font-medium text-ink" : "text-ink-3 hover-link")}>{byMoney === value && <Pill id={sortPill} />}<span className="relative">{text}</span></button>
            ))}
          </div>
        ) : <span className="t-meta hidden shrink-0 sm:inline">{metric ?? "visitors · signups"}</span>}
      </div>
      {panels?.[tab] ? <div role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label} className="flex-1 rounded-[18px] bg-pop p-1.5">{panels[tab]}</div> : <ul className="flex flex-1 flex-col gap-px rounded-[18px] bg-pop p-1.5" role="tabpanel" aria-label={tabs.find((t) => t.id === tab)?.label}>
        <AnimatePresence initial={false} mode="popLayout">
        {shown.map((row, index) => {
          const on = active?.[tab] === row.key, ghost = row.key === NO_VISIT;
          const conversion = row.visitors ? Math.round((row.signups / row.visitors) * 1000) / 10 : 0;
          const got = cents[row.key] ?? 0;
          const money = byMoney && earned;
          const bar = money ? (Math.max(0, got) / moneyMax) * 100 : (row.visitors / max) * 100, coral = !money && row.signups ? Math.max(bar * 0.06, Math.min(bar, bar * (row.signups / Math.max(1, row.visitors)) * 6)) : 0;
          const clip = (right: number, left = 0) => `inset(0% ${right.toFixed(2)}% 0% ${left.toFixed(2)}% round 10px)`;
          const grow = { type: "spring", visualDuration: 0.4, bounce: 0 } as const;
          return (
            <m.li key={slots[index]} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ layout: { type: "spring", visualDuration: 0.3, bounce: 0 }, opacity: { duration: 0.18 } }}>
              <button type="button" disabled={!onPick || ghost} onClick={() => onPick?.(tab, row.key)} aria-pressed={onPick && !ghost ? on : undefined} title={ghost ? `${usd(got)} from payments with no visit recorded: paid before tracking began, or on a device the tracker never saw` : `${n(row.visitors)} visitors, ${n(row.signups)} signups, ${conversion}% signed up${row.paid ? `, ${n(row.paid)} paid` : ""}${got ? `, ${usd(got)} revenue` : ""}`}
                className={cx("relative flex h-9 w-full items-center gap-3 overflow-hidden rounded-[10px] px-2.5 text-start text-13 disabled:cursor-default", on ? "bg-card-2" : onPick && !ghost && "hover-ghost")}>
                <m.span className="absolute inset-0 bg-wash-sky" initial={{ clipPath: clip(100), opacity: 1 }} animate={{ clipPath: clip(100 - bar), opacity: money ? 0 : 1 }} transition={{ clipPath: grow, opacity: { duration: 0.24 } }} aria-hidden />
                <m.span className="absolute inset-0 bg-wash-lime" initial={{ clipPath: clip(100), opacity: 0 }} animate={{ clipPath: clip(100 - bar), opacity: money ? 1 : 0 }} transition={{ clipPath: grow, opacity: { duration: 0.24 } }} aria-hidden />
                <m.span className="absolute inset-0 bg-wash-pink" initial={{ clipPath: clip(100, 0) }} animate={{ clipPath: clip(100 - bar, Math.max(0, bar - coral)), opacity: coral > 0 ? 1 : 0 }} transition={{ clipPath: grow, opacity: { duration: 0.24 } }} aria-hidden />
                <span className={cx("relative min-w-0 flex-1 truncate", ghost ? "text-ink-3" : "text-ink")}>{(() => { const text = ghost ? "no visit recorded" : label ? label(tab, row.key) : row.key; return typeof text === "string" ? <SwapText text={text} className="w-full" /> : text; })()}</span>
                <span className="relative w-12 text-end font-mono text-ink num">{ghost ? "-" : <Figure value={n(row.visitors)} className="!font-mono !text-13 !leading-5 !tracking-normal" />}</span>
                {!metric && <span className={cx("relative w-10 text-end font-mono num", row.signups ? "text-coral-deep" : "text-ink-4")}>{ghost ? "-" : n(row.signups)}</span>}
                {moneyCol && <span className={cx("relative w-16 text-end font-mono num", got > 0 ? "font-medium text-money" : got < 0 ? "text-bad" : "text-ink-4")}>{got ? usd(got, true) : "-"}</span>}
              </button>
            </m.li>
          );
        })}
        </AnimatePresence>
        {!rows.length && <li className="px-2.5 py-6 text-center text-13 text-ink-3">nothing in this window yet.</li>}
      </ul>}
      {more && !panels?.[tab] ? <Link to={more} className="text-link mx-auto mt-1.5 inline-flex h-8 items-center gap-1.5 px-3 font-mono text-[11.5px] tracking-[0.06em]"><Maximize size={13} strokeWidth={1.75} aria-hidden /> details</Link>
        : !panels?.[tab] && rows.length > limit && <button type="button" onClick={() => setAll((v) => !v)} className="text-link mx-auto mt-1.5 h-8 px-3 text-12">{all ? "show fewer" : `show all ${rows.length}`}</button>}
    </section>
  );
}

export function FilterChips({ filters, onRemove, label }: { filters: Record<string, string | undefined>; onRemove(dim: string): void; label?(dim: string, value: string): string }) {
  const list = Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (!list.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="filters">
      <span className="t-meta">filtered by</span>
      {list.map(([dim, value]) => (
        <span key={dim} className="inline-flex h-8 items-center gap-1 rounded-full bg-sky ps-3 pe-1 text-13 text-ink">
          {dim}: {label ? label(dim, value) : value}
          <button type="button" onClick={() => onRemove(dim)} aria-label={`remove the ${dim} filter`} className="grid size-6 place-items-center rounded-full hover-ghost"><X size={13} strokeWidth={2} /></button>
        </span>
      ))}
    </div>
  );
}
export { Plus };
