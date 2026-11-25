import { t } from "@/lib/i18n";
import type { ManagedSkill } from "../bot-settings/SkillsSection";

/** A skill the scan held back says so; any other shows what it does. */
export function skillRowHint(skill: ManagedSkill): string {
  return !skill.enabled && skill.warnings.length ? t("botPanel.skills.heldBack") : skill.description || skill.source;
}
