import { useState } from "react";

import { cn } from "@/lib/cn";
import { shareLearnedSkillsMode, skillAuthoringEnabled, skillsLibraryEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { api, useDispatch, useStoreSelector, type ConfigStatus } from "@/state/store";
import { SkillReviewSettings } from "./SkillReviewSettings";
import { friendlyError } from "@/lib/plain-error";

const MODES = [
  { value: "off", label: "settings.experimental.shareSkillsOff" },
  { value: "ask", label: "settings.experimental.shareSkillsAsk" },
  { value: "auto", label: "settings.experimental.shareSkillsAuto" },
] as const;

export function ShareLearnedSkillsSettings() {
  const dispatch = useDispatch();
  const config = useStoreSelector((s) => s.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!skillsLibraryEnabled(config)) return null;
  const authoring = skillAuthoringEnabled(config);
  const mode = shareLearnedSkillsMode(config);

  const choose = async (next: (typeof MODES)[number]["value"]) => {
    if (saving || next === mode) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { shareLearnedSkills: next } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(friendlyError(cause, t("settings.experimental.error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 border-t border-transparent pt-4" data-testid="share-learned-skills-settings">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-[18px] text-ink">{t("settings.experimental.shareSkills")}</div>
          {!authoring && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("settings.experimental.shareSkillsNeedsAuthoring")}</div>}
        </div>
        <div className="inline-flex shrink-0 rounded-xl bg-inset p-1" role="radiogroup" aria-label={t("settings.experimental.shareSkillsAria")}>
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mode === option.value}
              disabled={saving || !authoring}
              onClick={() => void choose(option.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                mode === option.value ? "bg-raised text-ink shadow" : "text-ink-secondary hover:text-ink",
              )}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>
      {error ? <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}

export function LearnedSkillsSettings() {
  return (
    <>
      <SkillReviewSettings />
      <ShareLearnedSkillsSettings />
    </>
  );
}
