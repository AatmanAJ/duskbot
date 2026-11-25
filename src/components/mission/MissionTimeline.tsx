import { useMemo, type CSSProperties } from "react";

import type { MissionMark, MissionSpan, MissionView } from "../../../shared/mission";
import { t } from "@/lib/i18n";
import { LaneLed } from "./LaneCard";
import { clock, laneWord, placeOn, tickStep } from "./mission-ui";

interface Row {
  key: string;
  label: string;
  depth: number;
  spans: MissionSpan[];
  marks: MissionMark[];
  lane: MissionView["board"][number];
}

function rowsOf(view: MissionView): Row[] {
  const rows: Row[] = [];
  for (const lane of view.board) {
    const spans = view.spans.filter((span) => span.laneThreadId === lane.threadId);
    const marks = view.marks.filter((mark) => mark.laneThreadId === lane.threadId);
    const order = [...new Set(spans.map((span) => span.assignmentId))];
    const own = order.filter((id) => spans.find((span) => span.assignmentId === id)!.depth === 0);
    rows.push({ key: lane.threadId, label: lane.botName, depth: 0, lane, spans: spans.filter((span) => own.includes(span.assignmentId)),
      marks: marks.filter((mark) => own.includes(mark.assignmentId) && mark.kind !== "handoff") });
    for (const id of order.filter((one) => !own.includes(one))) {
      const first = spans.find((span) => span.assignmentId === id)!;
      rows.push({ key: `${lane.threadId}:${id}`, label: first.botName, depth: Math.min(2, first.depth), lane,
        spans: spans.filter((span) => span.assignmentId === id), marks: marks.filter((mark) => mark.assignmentId === id) });
    }
  }
  return rows;
}

const markWord: Record<MissionMark["kind"], string> = {
  handoff: "→", asked: "?", answered: "✓", done: "■", failed: "✕", stopped: "■", stalled: "…",
};

export function MissionTimeline({ view, now }: { view: MissionView; now: number }) {
  const rows = useMemo(() => rowsOf(view), [view]);
  const from = view.launchedAt;
  const open = view.board.some((lane) => !lane.finishedAt && lane.state !== "idle" && lane.state !== "stopped" && lane.state !== "failed");
  const lastSeen = Math.max(from + 1, ...view.spans.map((span) => span.to ?? now), ...view.marks.map((mark) => mark.at));
  const to = Math.max(open ? now : lastSeen, from + 30_000);
  const step = tickStep(to - from);
  const ticks = Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, index) => from + index * step);
  const style = { "--mc-tick": `${(step / (to - from)) * 100}%` } as CSSProperties;
  const nowAt = placeOn(now, from, to);

  if (!view.spans.length) return <p className="px-1 py-3 text-[12.5px] text-ink-tertiary">{t("mission.timeline.empty")}</p>;
  return (
    <div role="group" aria-label={t("mission.timeline")} data-mission-timeline className="grid min-w-0 grid-cols-[132px_minmax(0,1fr)] gap-x-3">
      <div />
      <div className="relative mb-1 h-4">
        {ticks.filter((at) => !open || placeOn(at, from, to) < nowAt - 6 || at === from).map((at) => (
          <span key={at} className="mc-mono absolute -translate-x-1/2 text-[10px] text-ink-tertiary first:translate-x-0" style={{ left: `${placeOn(at, from, to)}%` }}>
            +{clock(at - from)}
          </span>
        ))}
        {open && <span className="mc-mono absolute -translate-x-full pr-1 text-[10px] font-semibold" style={{ left: `${nowAt}%`, color: "var(--mc-led-live)" }}>{t("mission.timeline.now")}</span>}
      </div>
      {rows.map((row) => (
        <div key={row.key} className="contents" data-timeline-row={row.depth ? "teammate" : "lane"}>
          <div className="flex min-w-0 items-center gap-1.5 py-[3px]" style={{ paddingLeft: row.depth * 12 }}>
            {row.depth === 0 ? <LaneLed state={row.lane.state} /> : <span aria-hidden="true" className="mc-mono text-[10px] text-ink-tertiary">└</span>}
            <span className={row.depth ? "truncate text-[11px] text-ink-secondary" : "truncate text-[12px] font-medium text-ink"}>{row.label}</span>
          </div>
          <div className="mc-well relative my-[2px] self-center overflow-hidden mc-track" data-depth={row.depth} style={style}>
            {row.spans.map((span, index) => {
              const left = placeOn(span.from, from, to);
              const right = placeOn(span.to ?? now, from, to);
              return (
                <span key={`${span.assignmentId}:${index}`} className="mc-span" data-state={span.state} data-open={span.to === undefined ? "" : undefined}
                  title={`${span.botName}: ${t(laneWord(span.state))} +${clock(span.from - from)}${span.to !== undefined && span.to > span.from ? ` → +${clock(span.to - from)}` : ""}`}
                  style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
              );
            })}
            {row.marks.map((mark, index) => (
              <span key={`${mark.assignmentId}:${mark.kind}:${index}`} className="mc-mark" data-kind={mark.kind}
                title={`${markWord[mark.kind]} ${mark.botName}${mark.detail ? `: ${mark.detail}` : ""}`} style={{ left: `${placeOn(mark.at, from, to)}%` }} />
            ))}
            {open && <span className="mc-now" style={{ left: `${nowAt}%` }} />}
          </div>
        </div>
      ))}
    </div>
  );
}
