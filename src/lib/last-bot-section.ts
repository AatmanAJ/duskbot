import type { BotSettingsSection } from "@/state/store";
import { PHONE_LAYOUT } from "./use-media-query";

export const LAST_BOT_SECTION_KEY = "duskbot.lastBotSection.v1";
/** Grok Bot keeps its info pane open across reloads (`sand.infoPane.open`): only the person closes it. */
export const BOT_PANEL_OPEN_KEY = "duskbot.botPanelOpen.v1";

export const BOT_SETTINGS_SECTION_IDS: readonly BotSettingsSection[] = [
  "overview",
  "identity",
  "slack",
  "soul",
  "skills",
  "memory",
  "library",
  "routines",
  "access",
  "model",
  "permissions",
  "voice",
  "visibility",
  "history",
  "usage",
  "computer",
];

export function readLastBotSection(): BotSettingsSection | null {
  try {
    const stored = globalThis.localStorage?.getItem(LAST_BOT_SECTION_KEY);
    return stored && (BOT_SETTINGS_SECTION_IDS as readonly string[]).includes(stored)
      ? stored as BotSettingsSection
      : null;
  } catch {
    return null;
  }
}

export function rememberBotSection(section: BotSettingsSection): void {
  try {
    globalThis.localStorage?.setItem(LAST_BOT_SECTION_KEY, section);
  } catch {
  }
}

export function readBotPanelOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(BOT_PANEL_OPEN_KEY) === "1" && globalThis.matchMedia?.(PHONE_LAYOUT).matches !== true;
  } catch {
    return false;
  }
}
