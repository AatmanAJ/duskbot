import { useEffect, useState } from "react";

import type { MissionSummary, MissionView } from "../../../shared/mission";
import { OPEN_LANE_STATES } from "../../../shared/mission";
import { Crosshair, Plus, RotateCcw, Square, X } from "@/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  closeMissionControl, composeMission, refreshMissions, selectMission, stopLane, useMissionFollow, useMissionList, useMissionListFailed,
  useMissionPage, useMissionView,
} from "@/state/missions";
import { useStore } from "@/state/store";
import { askConfirm } from "../ConfirmDialog";
import { WindowDragStrip } from "../DesktopCapabilities";
import { LaneCard } from "./LaneCard";
import { MissionResults } from "./MissionResults";
import { MissionTimeline } from "./MissionTimeline";
import { NewMissionSheet } from "./NewMissionSheet";
import { clock, laneLed, laneWord, missionLed, missionWord } from "./mission-ui";
import "./mission.css";

const TICK_MS = 1_000;

function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

function MissionLed({ state }: { state: MissionSummary["state"] }) {
  return <span aria-hidden="true" className="mc-led" data-led={missionLed(state)} />;
}

function MissionRail({ missions, current, failed }: { missions: MissionSummary[] | null; current: string | null; failed: boolean }) {
  return (
    <nav aria-label={t("mission.list")} className="flex w-[232px] shrink-0 flex-col border-r max-lg:hidden" style={{ borderColor: "var(--mc-edge)" }}>
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="mc-eyebrow flex-1">{t("mission.list")}</span>
        <span className="mc-mono text-[10.5px] text-ink-tertiary">{missions?.length ?? 0}</span>
      </div>
      {failed && !missions && (
        <button type="button" className="mx-3 flex items-center gap-1.5 text-left text-[12px] text-warning" onClick={() => void refreshMissions()}>
          <RotateCcw size={12} aria-hidden="true" />{t("mission.listFailed")} · {t("mission.tryAgain")}
        </button>
      )}
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        {(missions ?? []).map((mission) => (
          <li key={mission.id}>
            <button type="button" aria-current={mission.id === current} onClick={() => selectMission(mission.id)} data-mission-row={mission.id}
              className="mc-rail-row flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left hover:bg-raised/60">
              <span className="flex min-w-0 items-center gap-2">
                <MissionLed state={mission.state} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{mission.title}</span>
              </span>
              <span className="mc-mono pl-4 text-[10.5px] text-ink-tertiary">
                {t(missionWord(mission.state))} · {mission.lanes === 1 ? t("mission.lane.one") : t("mission.lanes", { count: mission.lanes })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function MissionHeader({ view, now }: { view: MissionView; now: number }) {
  const open = view.board.filter((lane) => OPEN_LANE_STATES.has(lane.state));
  const elapsed = (view.finishedAt ?? now) - view.launchedAt;
  const stopAll = async () => {
    const yes = await askConfirm({ title: t("mission.stopAll.confirm", { title: view.title }), body: t("mission.stopAll.body"), confirmLabel: t("mission.stopAll") });
    if (yes) await Promise.allSettled(open.map((lane) => stopLane(lane.botId, lane.threadId)));
  };
  const tally = (["working", "waiting", "needs-input", "queued", "done", "failed", "stopped", "idle"] as const).filter((state) => view.counts[state] > 0);
  return (
    <header className="flex flex-col gap-3 border-b px-5 pb-3 pt-3.5" style={{ borderColor: "var(--mc-edge)" }}>
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <MissionLed state={view.state} />
            <span className="mc-state-word mc-eyebrow" data-led={missionLed(view.state)}>{t(missionWord(view.state))}</span>
          </div>
          <h1 className="truncate text-[20px] font-semibold leading-6 tracking-[-0.01em] text-ink">{view.title}</h1>
        </div>
        {open.length > 0 && (
          <button type="button" className="mc-btn" data-tone="stop" onClick={() => void stopAll()}><Square size={12} aria-hidden="true" />{t("mission.stopAll")}</button>
        )}
      </div>
      <div className="mc-well flex flex-wrap items-stretch" data-mission-strip>
        <div className="flex flex-col justify-center border-r px-3 py-1.5" style={{ borderColor: "var(--mc-edge)" }}>
          <span className="mc-mono text-[20px] font-semibold leading-6 text-ink" data-mission-clock>{clock(elapsed)}</span>
          <span className="mc-eyebrow !text-[9.5px]">{view.finishedAt ? t("mission.took") : t("mission.elapsed")}</span>
        </div>
        {tally.map((state) => (
          <div key={state} className="flex flex-col justify-center px-3 py-1.5">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true" className="mc-led" data-led={laneLed(state)} />
              <span className="mc-mono text-[20px] font-semibold leading-6 text-ink">{view.counts[state]}</span>
            </span>
            <span className="mc-state-word text-[9.5px] font-semibold uppercase tracking-[0.1em]" data-led={laneLed(state)}>{t(laneWord(state))}</span>
          </div>
        ))}
      </div>
    </header>
  );
}

function MissionBody({ view }: { view: MissionView }) {
  const { state } = useStore();
  const [tab, setTab] = useState<"board" | "results">("board");
  const running = view.board.some((lane) => OPEN_LANE_STATES.has(lane.state));
  const now = useNow(running);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <MissionHeader view={view} now={now} />
      <div role="tablist" aria-label={view.title} className="flex gap-4 border-b px-5" style={{ borderColor: "var(--mc-edge)" }}>
        {(["board", "results"] as const).map((one) => (
          <button key={one} type="button" role="tab" aria-selected={tab === one} onClick={() => setTab(one)}
            className={cn("-mb-px border-b-2 py-2 text-[12.5px] font-medium", tab === one ? "text-ink" : "border-transparent text-ink-secondary hover:text-ink")}
            style={tab === one ? { borderColor: "var(--mc-led-live)" } : undefined}>
            {t(one === "board" ? "mission.tab.board" : "mission.tab.results")}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "board" ? (
          <div className="flex flex-col gap-5">
            <div data-mission-board className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {view.board.map((lane) => (
                <LaneCard key={lane.threadId} lane={lane} now={now} bot={state.bots.find((bot) => bot.id === lane.botId)} />
              ))}
            </div>
            <section className="mc-panel flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <span className="mc-eyebrow flex-1">{t("mission.timeline")}</span>
                <span className="mc-mono text-[10.5px] text-ink-tertiary">{t("mission.launched", { time: new Date(view.launchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}</span>
              </div>
              <MissionTimeline view={view} now={now} />
            </section>
          </div>
        ) : <MissionResults view={view} />}
      </div>
    </div>
  );
}

function MissionEmpty() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="mc-well flex size-12 items-center justify-center"><Crosshair size={22} aria-hidden="true" style={{ color: "var(--mc-led-live)" }} /></span>
      <h2 className="text-[16px] font-semibold text-ink">{t("mission.empty.title")}</h2>
      <p className="max-w-[420px] text-[13px] leading-[19px] text-ink-secondary">{t("mission.empty.body")}</p>
      <button type="button" className="mc-btn" data-tone="live" onClick={() => composeMission()}><Plus size={13} aria-hidden="true" />{t("mission.new")}</button>
    </div>
  );
}

export function MissionControl() {
  const page = useMissionPage();
  const missions = useMissionList();
  const failed = useMissionListFailed();
  const view = useMissionView(page.missionId);
  useMissionFollow(page.open && !page.composing ? page.missionId : null);
  useEffect(() => { void refreshMissions(); }, []);
  useEffect(() => {
    const leave = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-sidebar-bot-row], [data-sidebar-thread-row], [data-sidebar-group-row]")) closeMissionControl();
    };
    document.addEventListener("click", leave, true);
    return () => document.removeEventListener("click", leave, true);
  }, []);

  return (
    <main data-mission-control aria-label={t("mission.title")} className="relative flex h-full min-w-0 flex-1 flex-col bg-app">
      <WindowDragStrip />
      <div className="flex items-center gap-2.5 border-b px-4 py-2.5" style={{ borderColor: "var(--mc-edge)" }}>
        <Crosshair size={15} aria-hidden="true" style={{ color: "var(--mc-led-live)" }} />
        <span className="mc-eyebrow flex-1 !text-ink">{t("mission.title")}</span>
        <button type="button" className="mc-btn" data-tone="live" onClick={() => composeMission()}><Plus size={13} aria-hidden="true" />{t("mission.new")}</button>
        <button type="button" className="mc-btn" aria-label={t("mission.close")} onClick={closeMissionControl}><X size={13} aria-hidden="true" /></button>
      </div>
      <div className="flex min-h-0 flex-1">
        <MissionRail missions={missions} current={page.missionId} failed={failed} />
        {page.composing ? <div className="min-h-0 flex-1 overflow-y-auto p-5"><NewMissionSheet /></div>
          : view ? <MissionBody key={view.id} view={view} />
          : missions && missions.length === 0 ? <MissionEmpty />
          : <div className="flex-1" aria-busy="true" />}
      </div>
    </main>
  );
}
