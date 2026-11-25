import { useMemo, useState, type FormEvent } from "react";

import { MISSION_BRIEF_MAX, MISSION_MAX_LANES, MISSION_TITLE_MAX } from "../../../shared/mission";
import { Check, X, Zap } from "@/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { composeMission, launchMission } from "@/state/missions";
import { useStore } from "@/state/store";
import { BotAvatar } from "../Avatar";

export function NewMissionSheet() {
  const { state } = useStore();
  const bots = useMemo(() => state.bots.filter((bot) => !bot.hidden), [state.bots]);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = (id: string) => setPicked((now) => now.includes(id) ? now.filter((one) => one !== id)
    : now.length >= MISSION_MAX_LANES ? now : [...now, id]);
  const ready = title.trim() && brief.trim() && picked.length > 0 && !launching;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setLaunching(true);
    setProblem(null);
    const result = await launchMission({ title, brief, lanes: picked.map((botId) => ({ botId, note: notes[botId] })) });
    setLaunching(false);
    if (result.failed.length) {
      const names = result.failed.map((one) => bots.find((bot) => bot.id === one.botId)?.name ?? one.botId).join(", ");
      setProblem(t("mission.compose.partly", { count: result.failed.length, names }));
      composeMission(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} aria-label={t("mission.compose.title")} data-mission-compose
      className="mc-panel mx-auto flex w-full max-w-[760px] flex-col gap-4 p-5">
      <div className="flex items-center gap-2">
        <span className="mc-led" data-led="live" aria-hidden="true" />
        <h2 className="mc-eyebrow flex-1 !text-ink">{t("mission.compose.title")}</h2>
        <button type="button" className="mc-btn" aria-label={t("mission.compose.cancel")} onClick={() => composeMission(false)}><X size={13} aria-hidden="true" /></button>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="mc-eyebrow">{t("mission.compose.name")}</span>
        <input className="mc-field" value={title} maxLength={MISSION_TITLE_MAX} placeholder={t("mission.compose.namePlaceholder")}
          onChange={(event) => setTitle(event.target.value)} autoFocus />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="mc-eyebrow">{t("mission.compose.brief")}</span>
        <textarea className="mc-field min-h-[120px] resize-y leading-[19px]" value={brief} maxLength={MISSION_BRIEF_MAX - 1_000}
          placeholder={t("mission.compose.briefPlaceholder")} onChange={(event) => setBrief(event.target.value)} />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mc-eyebrow mb-1.5">{t("mission.compose.bots")} <span className="normal-case tracking-normal">· {t("mission.compose.botsHint", { max: MISSION_MAX_LANES })}</span></legend>
        {bots.length === 0 && <p className="text-[12.5px] text-ink-secondary">{t("mission.compose.noBots")}</p>}
        <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]">
          {bots.map((bot) => {
            const on = picked.includes(bot.id);
            const lane = picked.indexOf(bot.id);
            return (
              <button key={bot.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(bot.id)}
                className={cn("mc-well flex min-w-0 items-center gap-2 px-2 py-1.5 text-left", on && "!border-[var(--mc-led-live)]")}>
                <BotAvatar bot={bot} size={22} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{bot.name}</span>
                {on ? <span className="mc-mono text-[10.5px] font-semibold" style={{ color: "var(--mc-led-live)" }}>#{String(lane + 1).padStart(2, "0")}</span>
                  : <span className="size-3 rounded-[2px] border" style={{ borderColor: "var(--mc-edge)" }} />}
              </button>
            );
          })}
        </div>
      </fieldset>
      {picked.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {picked.map((id) => {
            const bot = bots.find((one) => one.id === id);
            if (!bot) return null;
            return (
              <label key={id} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                <span className="truncate text-[12px] text-ink-secondary">{t("mission.compose.note", { name: bot.name })}</span>
                <input className="mc-field !py-1.5" value={notes[id] ?? ""} placeholder={t("mission.compose.notePlaceholder")} maxLength={900}
                  onChange={(event) => setNotes((now) => ({ ...now, [id]: event.target.value }))} />
              </label>
            );
          })}
        </div>
      )}
      {problem && <p role="alert" className="text-[12.5px] text-warning">{problem}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="mc-btn" onClick={() => composeMission(false)}>{t("mission.compose.cancel")}</button>
        <button type="submit" className="mc-btn" data-tone="live" disabled={!ready}>
          {launching ? <Check size={13} aria-hidden="true" /> : <Zap size={13} aria-hidden="true" />}
          {launching ? t("mission.compose.launching") : picked.length === 1 ? t("mission.compose.launchOne") : t("mission.compose.launch", { count: picked.length })}
        </button>
      </div>
    </form>
  );
}
