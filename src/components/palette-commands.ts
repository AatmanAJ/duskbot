import type { AppSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { t, tOptional } from "@/lib/i18n";
import { SETTINGS_PANES, type AdvancedPage, type SettingsPane } from "@/lib/open-settings";
import type { IconName } from "./Icon";

export type SettingsTarget = SettingsPane | AdvancedPage | AppSettingsSection;

/** A search row that opens Settings where something lives: a pane by its rail name, or a setting by its row name. */
export type SettingsCommand = { id: string; name: string; detail: string; also?: string; icon: IconName; target: SettingsTarget };

type SettingRow = { id: string; titleKey: LocaleKey; paneKey: LocaleKey; icon: IconName; target: SettingsTarget };

const SETTING_ROWS: readonly SettingRow[] = [
  { id: "language", titleKey: "settings.language.title", paneKey: "settings.section.general", icon: "globe", target: "general" },
  { id: "send-key", titleKey: "settings.sendKey.title", paneKey: "settings.section.general", icon: "keyboard", target: "general" },
  { id: "import", titleKey: "settings.section.import", paneKey: "settings.section.general", icon: "arrow-bracket-to-down", target: "import" },
  { id: "people", titleKey: "settings.section.people", paneKey: "settings.pane.advanced", icon: "person-add", target: "people" },
  { id: "backups", titleKey: "settings.section.backups", paneKey: "settings.pane.advanced", icon: "database", target: "backups" },
  { id: "skills", titleKey: "settings.section.skills", paneKey: "settings.pane.advanced", icon: "skills", target: "skills" },
  { id: "archived", titleKey: "settings.advanced.bots.archived", paneKey: "settings.pane.advanced", icon: "archive", target: "advanced" },
];

/** Other words people search for a pane or setting with, in the active language. */
function synonyms(id: string): string | undefined {
  return tOptional(`palette.also.${id}` as LocaleKey);
}

export function settingsCommands(): SettingsCommand[] {
  const panes = SETTINGS_PANES.filter((pane) => pane.rail !== false).map((pane): SettingsCommand => ({
    id: `settings-${pane.id}`,
    name: t("palette.settingsPane", { pane: t(pane.labelKey) }),
    detail: t("settings.title"),
    also: synonyms(pane.id),
    icon: pane.icon,
    target: pane.id,
  }));
  const rows = SETTING_ROWS.map((row): SettingsCommand => ({
    id: `setting-${row.id}`,
    name: t(row.titleKey),
    detail: t("palette.inSettings", { pane: t(row.paneKey) }),
    also: synonyms(row.id),
    icon: row.icon,
    target: row.target,
  }));
  return [...panes, ...rows];
}
