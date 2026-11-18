import { useState } from "react";
import { cx } from "../ui/kit";
import { AnimatePresence } from "../ui/motion";
import { CustomerLink } from "./CustomerSheet";
import { useAdmin, useAdminRole } from "./api";
import { Avatar, percent, personName, usd } from "./kit";
import { BarRow, ChartCard } from "./charts";
import { n } from "./ui";
import type { InfraCustomer, InfraReport } from "./revenue-types";

const COLS = "grid-cols-[minmax(0,2fr)_72px_84px_84px_72px] max-md:grid-cols-[minmax(0,1fr)_auto]";
const COMPACT = "grid-cols-[minmax(0,1fr)_72px_64px]";

function Stat({ label, value, note, money }: { label: string; value: string; note?: string; money?: boolean }) {
  return (
    <div className={cx("min-w-0 rounded-[14px] px-3 py-2.5", money ? "bg-wash-lime" : "bg-card")} title={note}>
      <div className="truncate text-12 text-ink-3">{label}</div>
      <div className={cx("mt-0.5 truncate font-mono text-15 font-medium num", money ? "text-money" : "text-ink")}>{value}</div>
    </div>
  );
}

function Margin({ row }: { row: Pick<InfraCustomer, "margin"> }) {
  return <span className={cx("text-end font-mono text-13 num", row.margin === null ? "text-ink-4" : row.margin > 0 ? "font-medium text-money" : "text-ink-2")}>{row.margin === null ? "-" : percent(row.margin)}</span>;
}

function Row({ c, compact }: { c: InfraCustomer; compact?: boolean }) {
  return (
    <li>
      <CustomerLink accountId={c.accountId} className={cx("hover-row grid items-center gap-4 rounded-[12px] px-2.5 py-2", compact ? COMPACT : COLS)}>
        <span className="flex min-w-0 items-center gap-3">
          <Avatar seed={c.accountId} size={22} customer account={{ id: c.accountId }} />
          <span className="min-w-0">
            <span className="block truncate text-13 font-medium text-ink">{personName(c.accountId, c.email)}</span>
            <span className="block truncate text-12 text-ink-4">{c.plan}{compact && c.mrr > 0 ? `, ${usd(c.mrr)}/mo` : ""} · {c.awakeHours}h awake · {c.egressGb} gb out{c.egressState && <span className="text-warn"> · {c.egressState}</span>}</span>
          </span>
        </span>
        {!compact && <span className={cx("text-end font-mono text-13 num max-md:hidden", c.mrr > 0 ? "font-medium text-money" : "text-ink-4")}>{c.mrr > 0 ? usd(c.mrr) : "-"}</span>}
        <span className={cx("text-end font-mono text-13 text-ink num", !compact && "max-md:hidden")} title="instabox so far this month">{usd(c.costCents)}</span>
        {!compact && <span className="text-end font-mono text-13 text-ink-3 num max-md:hidden">{usd(c.projectedCents)}</span>}
        <Margin row={c} />
      </CustomerLink>
    </li>
  );
}

/** what the managed clouds cost on InstaBox this month, against what their owners pay */
export function InfraMargin() {
  const { data } = useAdmin<InfraReport>("/revenue/infra", 120_000);
  const [all, setAll] = useState(false);
  const owner = useAdminRole() === "owner";
  if (!data) return <div className="h-[220px] rounded-[24px] bg-card" aria-busy="true" />;
  const t = data.totals, list = all ? data.customers : data.customers.slice(0, 10);
  const most = Math.max(1, ...data.awake.map((bucket) => bucket.clouds));
  const fee = `${Math.round(data.assumptions.dodo.rate * 100)}% + ${usd(data.assumptions.dodo.fixedCents)}`;
  return (
    <>
      <ChartCard title="infra cost and margin" action={<span className="t-meta">{data.month}, {n(data.days)} {data.days === 1 ? "day" : "days"} measured</span>}>
        <div className="grid grid-cols-4 gap-1.5 max-lg:grid-cols-2">
          <Stat label="mrr" value={usd(t.mrr, true)} money />
          <Stat label="instabox, month to date" value={usd(t.costCents)} note={`compute ${usd(t.computeCents)}, disk ${usd(t.diskCents)}`} />
          <Stat label="instabox, full month pace" value={usd(t.projectedCents)} />
          <Stat label="gross margin" value={t.margin === null ? "-" : percent(t.margin)} note={`${usd(t.marginCents)} a month after fees and infra`} money={t.margin !== null && t.margin > 0} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-12 text-ink-3">
          <span>compute <span className="font-mono text-ink num">{usd(t.computeCents)}</span></span>
          <span>disk <span className="font-mono text-ink num">{usd(t.diskCents)}</span> (upper bound)</span>
          <span>dodo fees <span className="font-mono text-ink num">{usd(t.feeCents)}</span>/mo</span>
          {!owner && t.clouds > 0 && <span>per cloud <span className="font-mono text-ink num">{usd(Math.round(t.projectedCents / t.clouds))}</span>/mo pace</span>}
          {t.unbilledCents > 0 && <span>clouds with no paid plan <span className="font-mono text-ink num">{usd(t.unbilledCents)}</span></span>}
        </div>
        <p className="mt-2 px-1 text-12 text-ink-4">margin is mrr less dodo's {fee} per charge and this month's instabox cost at its current pace; disk is priced at {usd(data.assumptions.diskCentsPerGiBMonth)}/gb-month on every gb, ignoring the free 200 gb pool.</p>
      </ChartCard>
      <div className={cx("grid items-start gap-4 max-lg:grid-cols-1", owner ? "grid-cols-2" : "grid-cols-1")}>
        {owner && <ChartCard title="lowest margins">
          {data.worst.length ? <ul className="-m-1.5">{data.worst.map((c) => <Row key={c.accountId} c={c} compact />)}</ul> : <p className="py-6 text-center text-13 text-ink-3">no paying clouds measured yet.</p>}
        </ChartCard>}
        <ChartCard title="awake hours a day" action={<span className="t-meta">{n(t.clouds)} {t.clouds === 1 ? "cloud" : "clouds"}, average this month</span>}>
          <ul className="flex flex-col gap-px">
            <AnimatePresence initial={false}>
              {data.awake.map((bucket) => <BarRow key={bucket.label} label={bucket.label} value={n(bucket.clouds)} share={bucket.clouds / most} color="bg-wash-sky" />)}
            </AnimatePresence>
          </ul>
        </ChartCard>
      </div>
      {owner && <section aria-labelledby="infra-customers" className="rounded-[24px] bg-card p-2">
        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <h2 id="infra-customers" className="text-14 font-medium text-ink">cost per customer</h2>
          <span className="t-meta">{n(data.customers.length)}</span>
        </div>
        <div className="rounded-[18px] bg-pop p-1.5">
          {list.length ? (
            <>
              <div className={cx("grid gap-4 px-2.5 py-2 t-meta max-md:hidden", COLS)}><span>customer</span><span className="text-end">mrr</span><span className="text-end">so far</span><span className="text-end">month pace</span><span className="text-end">margin</span></div>
              <ul>{list.map((c) => <Row key={c.accountId} c={c} />)}</ul>
            </>
          ) : <p className="px-3 py-7 text-center text-13 text-ink-3">{data.collected ? "no managed cloud usage measured this month yet." : "usage collection is off here."}</p>}
        </div>
        {data.customers.length > 10 && <button type="button" onClick={() => setAll((v) => !v)} className="text-link mx-auto mt-1.5 block h-8 px-3 text-12">{all ? "show fewer" : `show all ${n(data.customers.length)}`}</button>}
      </section>}
    </>
  );
}
