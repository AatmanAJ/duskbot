import { useState } from "react";

import { openExternalLink } from "@/lib/app-links";
import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "../../bot-settings/BotEditorContext";
import { useManagedSkills, type ManagedSkill } from "../../bot-settings/SkillsSection";
import { friendlyError } from "@/lib/plain-error";
import { askConfirm } from "../../ConfirmDialog";

const SKILLS_SITE = "https://skills.sh";

function errorText(error: unknown, fallback: string): string {
  return friendlyError(error, fallback);
}

/** A bot's skills with what the panel does to them: switch, remove after asking, add from a link, browse for more. */
export function useSkillActions(bot: Bot) {
  const { request: api } = useBotEditor();
  const { state, dispatch } = useStore();
  const skills = useManagedSkills(bot);
  const [source, setSource] = useState("");
  const [importing, setImporting] = useState(false);
  const libraryOn = skillsLibraryEnabled(state.config);

  const remove = async (skill: ManagedSkill) => {
    if (skills.working) return;
    if (!(await askConfirm({ title: t("botPanel.skills.removeConfirm", { name: skill.name }), confirmLabel: t("confirm.remove") }))) return;
    skills.setWorking(skill.name);
    skills.setError("");
    try {
      if (skill.origin === "library") await skills.putAssignments(skill.name, true);
      else {
        await api(`/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`, { method: "DELETE" });
        await skills.refresh();
      }
    } catch (cause) {
      skills.setError(errorText(cause, t("botPanel.skills.removeFailed")));
    } finally {
      skills.setWorking("");
    }
  };
  const importSkill = async () => {
    const trimmed = source.trim();
    if (!trimmed || importing) return;
    setImporting(true);
    skills.setError("");
    try {
      await api(`/api/bots/${bot.id}/skills`, { method: "POST", body: JSON.stringify({ source: trimmed }) });
      setSource("");
      await skills.refresh();
    } catch (cause) {
      skills.setError(errorText(cause, t("botPanel.skills.importFailed")));
    } finally {
      setImporting(false);
    }
  };
  const browse = () => {
    if (libraryOn) {
      dispatch({ type: "toggleAppSettings", open: true, section: "skills" });
      return;
    }
    void openExternalLink(SKILLS_SITE);
  };

  return { skills, source, setSource, importing, remove, importSkill, browse };
}
