import { useEffect, useMemo, useState } from "react";

import type { LaneDiff, LaneDiffFile, MissionLane, MissionView } from "../../../shared/mission";
import { Copy, GitBranch, RotateCcw, Trash2 } from "@/icons";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { friendlyError } from "@/lib/plain-error";
import { readLaneDiff, removeLaneFolder } from "@/state/missions";
import { askConfirm } from "../ConfirmDialog";
import { LaneLed } from "./LaneCard";

const CHANGE_MARK: Record<LaneDiffFile["change"], string> = { added: "A", changed: "M", deleted: "D", renamed: "R" };

type Loaded = { lane: string; diff: LaneDiff } | { lane: string; error: string };

function useLaneDiff(missionId: string, lane: MissionLane | undefined, version: string): { loaded: Loaded | null; reload: () => void } {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [nonce, setNonce] = useState(0);
  const threadId = lane?.threadId;
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    readLaneDiff(missionId, threadId)
      .then((diff) => { if (live) setLoaded({ lane: threadId, diff }); })
      .catch((error: unknown) => { if (live) setLoaded({ lane: threadId, error: friendlyError(error) }); });
    return () => { live = false; };
  }, [missionId, threadId, version, nonce]);
  return { loaded: loaded?.lane === threadId ? loaded : null, reload: () => setNonce((n) => n + 1) };
}

function PatchView({ patch }: { patch: string }) {
  const lines = useMemo(() => patch.split("\n"), [patch]);
  return (
    <pre data-lane-patch className="mc-mono overflow-x-auto px-0 py-2 text-[11.5px] leading-[17px]">
      {lines.map((line, index) => {
        const kind = line.startsWith("diff --git") ? "file" : line.startsWith("@@") ? "hunk" : line.startsWith("+++") || line.startsWith("---") || /^(?:index|new file|deleted file|similarity|rename) /.test(line) ? "meta"
          : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
        return <div key={index} data-line={kind} className={cn("min-w-max whitespace-pre px-3",
          kind === "add" && "bg-[color-mix(in_srgb,var(--mc-led-done)_14%,transparent)] text-ink",
          kind === "del" && "bg-[color-mix(in_srgb,var(--mc-led-fail)_14%,transparent)] text-ink",
          kind === "hunk" && "text-[var(--mc-led-wait)]",
          kind === "file" && "mt-2 border-t pt-2 font-semibold text-ink first:mt-0 first:border-t-0 first:pt-0",
          kind === "meta" && "text-ink-tertiary",
          kind === "ctx" && "text-ink-secondary")} style={kind === "file" ? { borderColor: "var(--mc-edge)" } : undefined}>{line || " "}</div>;
      })}
    </pre>
  );
}

export function MissionReview({ view, focus }: { view: MissionView; focus: string | null }) {
  const lanes = view.board.filter((lane) => lane.worktree);
  const [chosen, setChosen] = useState<string | null>(focus);
  useEffect(() => { if (focus) setChosen(focus); }, [focus]);
  const lane = lanes.find((one) => one.threadId === chosen) ?? lanes[0];
  const { loaded, reload } = useLaneDiff(view.id, lane, view.version);
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!lanes.length) return <p className="text-[12.5px] text-ink-tertiary">{t("mission.review.none")}</p>;
  const diff = loaded && "diff" in loaded ? loaded.diff : null;
  const totals = diff ? diff.files.reduce((sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }), { added: 0, removed: 0 }) : null;
  const removeFolder = async () => {
    if (!lane) return;
    const yes = await askConfirm({ title: t("mission.review.removeConfirm", { name: lane.botName }), body: t("mission.review.removeBody", { branch: lane.worktree!.branch }), confirmLabel: t("mission.review.remove") });
    if (!yes) return;
    setProblem(null);
    try { await removeLaneFolder(view.id, lane.threadId); reload(); } catch (error) { setProblem(friendlyError(error)); }
  };

  return (
    <section aria-label={t("mission.tab.review")} data-mission-review className="grid min-w-0 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
      <ul className="mc-panel flex flex-col self-start py-1" aria-label={t("mission.review.lanes")}>
        {lanes.map((one) => (
          <li key={one.threadId}>
            <button type="button" aria-current={one.threadId === lane?.threadId} onClick={() => setChosen(one.threadId)}
              className="mc-rail-row flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-raised/60">
              <LaneLed state={one.state} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{one.botName}</span>
              <span className="mc-mono text-[10.5px] text-ink-tertiary">{one.files.length}</span>
            </button>
          </li>
        ))}
      </ul>
      {lane && (
        <div className="mc-panel flex min-w-0 flex-col">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2.5" style={{ borderColor: "var(--mc-edge)" }}>
            <GitBranch size={13} aria-hidden="true" style={{ color: "var(--mc-led-live)" }} />
            <span className="mc-mono min-w-0 truncate text-[12px] font-semibold text-ink" data-lane-branch>{lane.worktree!.branch}</span>
            <span className="mc-mono text-[11px] text-ink-tertiary">{t("mission.review.from", { commit: lane.worktree!.base.slice(0, 7) })}</span>
            {diff?.commits ? <span className="mc-mono text-[11px] text-ink-tertiary">· {t("mission.review.commits", { count: diff.commits })}</span> : null}
            {totals && (
              <span className="mc-mono text-[11.5px]" data-lane-totals>
                <span style={{ color: "var(--mc-led-done)" }}>+{totals.added}</span> <span style={{ color: "var(--mc-led-fail)" }}>−{totals.removed}</span>
              </span>
            )}
            <span className="ml-auto flex gap-1.5">
              <button type="button" className="mc-btn" onClick={() => void copyText(lane.worktree!.branch).then((result) => setCopied(result === "copied"))}>
                <Copy size={12} aria-hidden="true" />{copied ? t("mission.results.copied") : t("mission.review.copyBranch")}
              </button>
              <button type="button" className="mc-btn" aria-label={t("mission.review.refresh")} onClick={reload}><RotateCcw size={12} aria-hidden="true" /></button>
              {diff && !diff.gone && (
                <button type="button" className="mc-btn" data-tone="stop" disabled={lane.state === "working"} onClick={() => void removeFolder()}>
                  <Trash2 size={12} aria-hidden="true" />{t("mission.review.remove")}
                </button>
              )}
            </span>
          </header>
          {problem && <p role="alert" className="px-3 pt-2 text-[12px] text-danger">{problem}</p>}
          {!loaded && <p className="px-3 py-3 text-[12.5px] text-ink-tertiary" aria-busy="true">{t("mission.review.reading")}</p>}
          {loaded && "error" in loaded && <p role="alert" className="px-3 py-3 text-[12.5px] text-danger">{loaded.error}</p>}
          {diff?.gone && <p className="px-3 py-3 text-[12.5px] text-ink-secondary">{t("mission.review.gone", { branch: diff.branch })}</p>}
          {diff && !diff.gone && !diff.files.length && <p className="px-3 py-3 text-[12.5px] text-ink-tertiary">{t("mission.review.noChanges")}</p>}
          {diff && diff.files.length > 0 && (
            <>
              <ul className="flex flex-col border-b py-1.5" style={{ borderColor: "var(--mc-edge)" }} data-lane-files>
                {diff.files.map((file) => (
                  <li key={file.path} className="mc-mono flex min-w-0 items-center gap-2 px-3 py-[3px] text-[11.5px]" data-file-change={file.change}>
                    <span className="w-3 shrink-0 font-semibold" style={{ color: file.change === "added" ? "var(--mc-led-done)" : file.change === "deleted" ? "var(--mc-led-fail)" : "var(--mc-led-wait)" }}>{CHANGE_MARK[file.change]}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{file.from ? `${file.from} → ${file.path}` : file.path}</span>
                    {file.binary ? <span className="text-ink-tertiary">{t("mission.review.binary")}</span> : (
                      <span><span style={{ color: "var(--mc-led-done)" }}>+{file.added}</span> <span style={{ color: "var(--mc-led-fail)" }}>−{file.removed}</span></span>
                    )}
                  </li>
                ))}
              </ul>
              <PatchView patch={diff.patch} />
              {diff.truncated && <p className="px-3 pb-3 text-[12px] text-warning">{t("mission.review.truncated")}</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
