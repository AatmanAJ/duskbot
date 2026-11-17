import { storeApp } from "@/lib/store-app";
import type { Action, AppState } from "../store";
import { withMascotMotion } from "./helpers";

type Reduce = (state: AppState, action: Action) => AppState;

const UI_ACTIONS = new Set<Action["type"]>([
  "connected",
  "loadFailed",
  "error",
  "toggleSettings",
  "togglePlugins",
  "botCreationPending",
  "notice",
  "revealThread",
  "focusMessage",
  "focusMessageConsumed",
  "unreadDividerDone",
  "openSignIn",
  "signInFocusConsumed",
  "toggleComputer",
  "toggleAppSettings",
  "toggleShortcuts",
  "openCloudAdd",
  "closeCloudAdd",
  "cloudHowTo",
  "toggleWelcome",
  "showChat",
] as const satisfies ReadonlyArray<Action["type"]>);

export type UiAction = Extract<Action, { type: "connected" | "loadFailed" | "error" | "toggleSettings" | "togglePlugins" | "botCreationPending" | "notice" | "revealThread" | "focusMessage" | "focusMessageConsumed" | "unreadDividerDone" | "openSignIn" | "signInFocusConsumed" | "toggleComputer" | "toggleAppSettings" | "toggleShortcuts" | "openCloudAdd" | "closeCloudAdd" | "cloudHowTo" | "toggleWelcome" | "showChat" }>;

export const isUiAction = (action: Action): action is UiAction => UI_ACTIONS.has(action.type);

export function reduceUi(state: AppState, action: UiAction, reduce: Reduce): AppState {
  switch (action.type) {
    case "showChat":
      return state.activeView === "chat" ? state : { ...state, activeView: "chat" };
    case "connected":
      return { ...state, connected: action.value };
    case "loadFailed":
      return state.hydrated || state.loadFailed ? state : { ...state, loadFailed: true };
    case "error":
      return {
        ...(action.message && state.selectedId
          ? withMascotMotion(state, state.selectedId, "alert")
          : state),
        error: action.message,
      };
    case "toggleSettings": {
      if (action.botId !== undefined && !state.bots.some((bot) => bot.id === action.botId && !bot.hidden)) return state;
      const selectedId = action.botId ?? state.selectedId;
      const open = action.open ?? (action.botId !== undefined || !state.settingsOpen);
      const freshOpen = open && !state.settingsOpen;
      const named = action.section !== undefined;
      return {
        ...state,
        selectedId,
        settingsOpen: open,
        botSettingsSection: action.section ?? state.botSettingsSection,
        botSettingsExpandAccordion: open ? named || (freshOpen && state.botSettingsSectionStored) : false,
        botSettingsExpandRemembered: open ? !named && freshOpen && state.botSettingsSectionStored : false,
        botSettingsSectionStored: named || state.botSettingsSectionStored,
        appSettingsOpen: open ? false : state.appSettingsOpen,
      };
    }
    case "togglePlugins": {
      const open = action.open ?? !state.pluginsOpen;
      return {
        ...state,
        pluginsOpen: open,
        pluginsSurface: action.surface ?? state.pluginsSurface,
        ...(open ? { appSettingsOpen: false, shortcutsOpen: false } : {}),
      };
    }
    case "botCreationPending":
      return { ...state, botCreationPending: action.on };
    case "notice":
      return { ...state, notice: action.notice };
    case "revealThread":
      return { ...state, appSettingsOpen: false, shortcutsOpen: false, pluginsOpen: false, revealThread: { threadId: action.threadId, nonce: (state.revealThread?.nonce ?? 0) + 1 } };
    case "focusMessage":
      return {
        ...state,
        focusMessage: {
          threadId: action.threadId,
          messageId: action.messageId,
          matchText: action.matchText,
          nonce: (state.focusMessage?.nonce ?? 0) + 1,
          consumed: false,
        },
      };
    case "focusMessageConsumed":
      if (!state.focusMessage || state.focusMessage.nonce !== action.nonce) return state;
      return { ...state, focusMessage: { ...state.focusMessage, consumed: true } };
    case "unreadDividerDone":
      return state.unreadDivider?.threadId === action.threadId ? { ...state, unreadDivider: null } : state;
    case "openSignIn": {
      if (!state.bots.some((bot) => bot.id === action.botId)) return state;
      const selected = reduce(reduce(state, { type: "select", id: action.botId }), { type: "toggleComputer", open: true });
      const { type: _, ...request } = action;
      return { ...selected, signInFocus: { ...request, requestId: (state.signInFocus?.requestId ?? 0) + 1, consumed: false } };
    }
    case "signInFocusConsumed":
      return state.signInFocus?.requestId === action.requestId
        ? { ...state, signInFocus: { ...state.signInFocus, consumed: true } } : state;
    case "toggleComputer": {
      // the bot's computer lives on its panel's Computer tab: there is no separate screen panel to open or close
      if (action.open === false) return state;
      const shown = reduce(state, { type: "toggleSettings", open: true, section: "computer", ...(action.botId !== undefined ? { botId: action.botId } : {}) });
      return shown === state ? state : { ...shown, computerTabRequest: state.computerTabRequest + 1 };
    }
    case "toggleAppSettings": {
      const open = action.open ?? !state.appSettingsOpen;
      return {
        ...state,
        // Settings is a modal over the window: whatever side panel was open stays open under it, as in Grok Bot.
        appSettingsOpen: open,
        appSettingsSection: action.section ?? state.appSettingsSection,
        appSettingsCloudLink: action.cloudLink && open ? state.appSettingsCloudLink + 1 : 0,
        appSettingsPhonePairing: action.phonePairing && open ? state.appSettingsPhonePairing + 1 : 0,
        appSettingsRequest: open ? state.appSettingsRequest + 1 : state.appSettingsRequest,
        pluginsOpen: open ? false : state.pluginsOpen,
      };
    }
    case "toggleShortcuts": {
      const open = action.open ?? !state.shortcutsOpen;
      return {
        ...state,
        shortcutsOpen: open,
      };
    }
    case "openCloudAdd":
      if (storeApp()) return state;
      return { ...state, cloudAdd: state.cloudAdd ?? { source: action.source, ...(action.signIn ? { signIn: true as const } : {}) }, cloudHowTo: false };
    case "closeCloudAdd":
      return state.cloudAdd ? { ...state, cloudAdd: null } : state;
    case "cloudHowTo":
      return state.cloudHowTo === action.open ? state : { ...state, cloudHowTo: action.open };
    case "toggleWelcome": {
      const open = action.open ?? !state.welcomeOpen;
      return {
        ...state,
        welcomeOpen: open,
        appSettingsOpen: open ? false : state.appSettingsOpen,
        shortcutsOpen: open ? false : state.shortcutsOpen,
      };
    }
  }
}
