import type { AppSettingsSection } from "@/state/store";
import { en, type LocaleKey } from "@/locales";
import { activeLocale, t, tOptional } from "@/lib/i18n";
import { SETTINGS_PANES, type AdvancedPage, type SettingsPane } from "@/lib/open-settings";
import type { SimplePageId } from "./bot-panel/page-registry";
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

/** A search row that opens the open bot's side panel on one of its pages. */
export type BotPageCommand = { id: string; name: string; detail: string; also?: string; icon: IconName; page: SimplePageId };

type BotPageRow = { page: SimplePageId; titleKey: LocaleKey; icon: IconName };

const BOT_PAGE_ROWS: readonly BotPageRow[] = [
  { page: "routines", titleKey: "botPanel.ui.botSettingsSimpleRoutines", icon: "alarm-clock" },
  { page: "memory", titleKey: "botPanel.memoryRow", icon: "brain" },
  { page: "library", titleKey: "botPanel.tab.library", icon: "book" },
];

/** Other words people search for a pane or setting with: the active language's, and in another language the English
 * name and words as well, since people type either. */
function searchWords(id: string, englishName: string): string | undefined {
  const key = `palette.also.${id}` as LocaleKey;
  const local = tOptional(key);
  if (activeLocale() === "en") return local;
  return [local, englishName, en[key]].filter(Boolean).join(" ");
}

export function settingsCommands(): SettingsCommand[] {
  const panes = SETTINGS_PANES.filter((pane) => pane.rail !== false).map((pane): SettingsCommand => ({
    id: `settings-${pane.id}`,
    name: t("palette.settingsPane", { pane: t(pane.labelKey) }),
    detail: t("settings.title"),
    also: searchWords(pane.id, `${en["settings.title"]} ${en[pane.labelKey]}`),
    icon: pane.icon,
    target: pane.id,
  }));
  const rows = SETTING_ROWS.map((row): SettingsCommand => ({
    id: `setting-${row.id}`,
    name: t(row.titleKey),
    detail: t("palette.inSettings", { pane: t(row.paneKey) }),
    also: searchWords(row.id, en[row.titleKey]),
    icon: row.icon,
    target: row.target,
  }));
  return [...panes, ...rows];
}

export function botPageCommands(botName: string): BotPageCommand[] {
  return BOT_PAGE_ROWS.map((row): BotPageCommand => ({
    id: `bot-${row.page}`,
    name: t(row.titleKey),
    detail: botName,
    also: searchWords(row.page, en[row.titleKey]),
    icon: row.icon,
    page: row.page,
  }));
}
