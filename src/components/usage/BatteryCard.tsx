import { useState } from "react";
import { Repeat } from "../../icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { fetchBattery, sharePercent, useLoadedState, type BatteryRow } from "@/lib/spend";
import { formatTokens } from "@/lib/usage";
import { formatCost } from "@/lib/usage-trace";
import { MASCOT_INK } from "@/lib/mascot";
import { useStore } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { Card as RowsCard, NavRow, NoteRow, rowCls } from "../ListRows";
import { SpendCap } from "./SpendCap";
import { LoadFailedRow } from "./LoadFailedRow";
import { ArtState } from "../ui/Art";

const SHOWN = 6;

/** What used the last seven days, ranked like a phone's Battery screen: each bot with its routines under it. */
export function BatteryCard({ version }: { version: number }) {
  const { state } = useStore();
  const [saved, setSaved] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const { value: report, failed, retry } = useLoadedState(fetchBattery, `${version}:${saved}`);
  const bots = report?.rows.filter((row) => row.kind === "bot") ?? [];
  const routinesOf = (botId: string) => report?.rows.filter((row) => row.kind === "routine" && row.botId === botId) ?? [];
  const amount = (row: BatteryRow) => (report?.basis === "usd" ? formatCost(row.usd) : formatTokens(row.tokens));

  const line = (row: BatteryRow, nested: boolean) => {
    const key = `${row.kind}:${row.id}`;
    const bot = row.kind === "bot" ? state.bots.find((one) => one.id === row.id) : undefined;
    return (
      <li key={key}>
        <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)} data-battery-row={key}
          className={cn(rowCls, "grid w-full cursor-pointer grid-cols-[minmax(0,11rem)_1fr_auto] gap-3 text-start text-[13px] leading-[18px] transition-colors duration-100 ease-out hover:bg-ink/[0.035] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus", !nested && "min-h-[36px]")}>
          <span className={cn("flex min-w-0 items-center gap-2.5 text-ink", nested && "ps-7")}>
            {bot ? <BotAvatar bot={bot} state="idle" size={20} animated={false} /> : row.kind === "routine" ? <Repeat size={13} aria-hidden="true" className="shrink-0 text-ink-tertiary" /> : null}
            <span className="min-w-0">
              <span className="block truncate">{row.name}</span>
              {row.capUsd !== undefined && <span className="block truncate text-[12px] leading-4 text-ink-secondary">{t("usage.cap.amount", { amount: formatCost(row.capUsd) })}</span>}
            </span>
          </span>
          <span className={cn("overflow-hidden rounded-full bg-ink/[0.06]", nested ? "h-1" : "h-1.5")} aria-hidden="true">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, row.share * 100)}%`, background: bot ? MASCOT_INK[bot.color] ?? MASCOT_INK.blue : "color-mix(in srgb, var(--color-ink) 35%, transparent)", opacity: nested ? 0.55 : 0.85 }} />
          </span>
          <span className="min-w-[6.5rem] text-end tabular-nums text-ink-secondary">
            <span className={nested ? "text-ink-secondary" : "text-ink"}>{amount(row)}</span>
            <span className="ms-1.5 inline-block min-w-[2.5rem] text-[12px] text-ink-tertiary">{sharePercent(row.share)}</span>
          </span>
        </button>
        {open === key && (
          <div className={cn("px-2 pb-2", nested ? "ps-8" : "ps-9")}>
            <SpendCap kind={row.kind} id={row.id} capUsd={row.capUsd} onSaved={() => setSaved((n) => n + 1)} />
          </div>
        )}
      </li>
    );
  };

  return (
    <RowsCard label={t("usage.battery.title")} footnote={report?.basis === "tokens" && report.rows.length ? t("usage.battery.tokensNote") : undefined} data-settings-block="battery">
      {!report && failed ? <LoadFailedRow text={t("usage.battery.failed")} onRetry={retry} />
        : !report ? <NoteRow>{t("common.checking")}</NoteRow> : !bots.length ? <ArtState data-art-state="battery" art="mug" title={t("empty.battery.title")} className="py-6">{t("empty.battery.hint")}</ArtState> : (
        <ul className="contents">
          {(all ? bots : bots.slice(0, SHOWN)).flatMap((bot) => [line(bot, false), ...routinesOf(bot.id).map((routine) => line(routine, true))])}
        </ul>
      )}
      {bots.length > SHOWN && !all && <NavRow drill={false} title={t("usage.battery.all", { count: String(bots.length) })} onClick={() => setAll(true)} />}
    </RowsCard>
  );
}
