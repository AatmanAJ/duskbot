import { useEffect, useState } from "react";

import type { LaneFile, MissionView } from "../../../shared/mission";
import { OPEN_LANE_STATES } from "../../../shared/mission";
import { ArrowUpRight, Copy, FileText } from "@/icons";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { ChatMarkdown } from "../ChatMarkdown";
import { LaneLed, LaneStateWord } from "./LaneCard";
import { laneWord } from "./mission-ui";

const COPIED_MS = 1_600;
const CHANGE_MARK: Record<LaneFile["change"], string> = { added: "+", changed: "~", deleted: "−" };
const CHANGE_COLOR: Record<LaneFile["change"], string> = { added: "var(--mc-led-done)", changed: "var(--mc-led-wait)", deleted: "var(--mc-led-fail)" };

export function missionMarkdown(view: MissionView): string {
  const parts = [`# ${view.title}`];
  for (const lane of view.board) {
    parts.push("", `## ${lane.botName}: ${t(laneWord(lane.state))}`, "", lane.reply ?? lane.reason);
    if (lane.files.length) parts.push("", ...lane.files.map((file) => `- ${CHANGE_MARK[file.change]} \`${file.path}\``));
  }
  return `${parts.join("\n")}\n`;
}

export function MissionResults({ view }: { view: MissionView }) {
  const { dispatch } = useStore();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const replied = view.board.filter((lane) => lane.reply);
  return (
    <section aria-label={t("mission.tab.results")} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="mc-eyebrow">{replied.length}/{view.board.length}</span>
        <button type="button" className="mc-btn ml-auto" disabled={!replied.length}
          onClick={() => void copyText(missionMarkdown(view)).then((result) => setCopied(result === "copied"))}>
          <Copy size={12} aria-hidden="true" />{copied ? t("mission.results.copied") : t("mission.results.copy")}
        </button>
      </div>
      {!replied.length && <p className="text-[12.5px] text-ink-tertiary">{t("mission.results.empty")}</p>}
      <div className="grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {view.board.map((lane) => (
          <article key={lane.threadId} className="mc-panel flex min-w-0 flex-col" data-mission-result={lane.threadId}>
            <header className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--mc-edge)" }}>
              <LaneLed state={lane.state} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{lane.botName}</span>
              <LaneStateWord state={lane.state} />
              <button type="button" className="mc-btn" aria-label={t("mission.lane.openNamed", { name: lane.botName })}
                onClick={() => dispatch({ type: "switchTask", botId: lane.botId, threadId: lane.threadId, whole: true })}>
                <ArrowUpRight size={12} aria-hidden="true" />
              </button>
            </header>
            <div className="min-h-[96px] px-3 py-2.5 text-[13px] leading-[19px] text-ink">
              {lane.reply ? <ChatMarkdown text={lane.reply} />
                : <span className="text-ink-tertiary">{OPEN_LANE_STATES.has(lane.state) ? t("mission.results.waiting") : lane.reason}</span>}
            </div>
            {lane.files.length > 0 && (
              <ul className="flex flex-col gap-0.5 border-t px-3 py-2" style={{ borderColor: "var(--mc-edge)" }}>
                {lane.files.map((file) => (
                  <li key={file.path} data-file-change={file.change} className="mc-mono flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-secondary">
                    <span aria-hidden="true" className="w-2.5 shrink-0 text-center font-semibold" style={{ color: CHANGE_COLOR[file.change] }}>{CHANGE_MARK[file.change]}</span>
                    <FileText size={11} aria-hidden="true" className="shrink-0" /><span className="truncate">{file.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
