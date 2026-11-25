import { Crosshair } from "@/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { closeMissionControl, openMissionControl, useMissionPage } from "@/state/missions";
import { useStore } from "@/state/store";

export function workingLanes(bots: ReadonlyArray<{ tasks?: ReadonlyArray<{ mission?: unknown; busy?: boolean; activity?: string }> }>): number {
  return bots.reduce((sum, bot) => sum + (bot.tasks ?? []).filter((task) => task.mission && (task.busy || task.activity === "working")).length, 0);
}

export function MissionControlRow({ compact = false }: { compact?: boolean }) {
  const { state } = useStore();
  const page = useMissionPage();
  const shownBots = state.bots.filter((bot) => !bot.hidden);
  if (shownBots.length < 2) return null;
  const working = workingLanes(shownBots);
  const label = working ? `${t("mission.title")}, ${t("mission.running", { count: working })}` : t("mission.title");
  return (
    <div className={compact ? "px-1" : "px-2 pb-1"}>
      <button type="button" data-mission-control-row aria-pressed={page.open} aria-label={label} title={label}
        onClick={() => (page.open ? closeMissionControl() : openMissionControl())}
        className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-ink-secondary hover:bg-raised/60 hover:text-ink",
          page.open && "bg-raised text-ink")}>
        <Crosshair size={15} aria-hidden="true" className="shrink-0" style={working ? { color: "var(--identity-red)" } : undefined} />
        {!compact && <span className="min-w-0 flex-1 truncate">{t("mission.title")}</span>}
        {working > 0 && (
          <span className="flex items-center gap-1 rounded-[3px] px-1.5 text-[11px] font-semibold tabular-nums text-white" style={{ background: "var(--identity-red)" }}>
            {working}
          </span>
        )}
      </button>
    </div>
  );
}
