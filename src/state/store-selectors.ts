import type { AppState, Bot } from "./store";
import { botById } from "./store-index";

export const selectBots = (state: AppState) => state.bots;
export const selectGroups = (state: AppState) => state.groups;
export const selectConfig = (state: AppState) => state.config;
export const selectInstances = (state: AppState) => state.instances;
export const selectSettingsOpen = (state: AppState) => state.settingsOpen;
export const selectError = (state: AppState) => state.error;
export const selectNotice = (state: AppState) => state.notice;
export const selectFocusMessage = (state: AppState) => state.focusMessage;
export const selectPendingQueued = (state: AppState) => state.pendingQueued;

const drawnBot = (bot: Bot) =>
  [bot.id, bot.name, bot.hidden, bot.color, bot.mascotBody, bot.mascotExpression, bot.mascotFaceColor, bot.avatarUrl, bot.avatarCrop, bot.avatarZoom, bot.avatarFocusX, bot.avatarFocusY].join("\u0001");

/** Equal while every bot keeps the name, colour and face a chat draws it with: a message to some bot leaves it equal. */
export const sameDrawnBots = (a: readonly Bot[], b: readonly Bot[]) =>
  a === b || (a.length === b.length && a.every((bot, index) => drawnBot(bot) === drawnBot(b[index]!)));

/** The bots of `ids` that exist, in that order; compare with shallowEqual (useStoreShallow). */
export const botsOf = (state: AppState, ids: readonly string[]): Bot[] =>
  ids.map((id) => botById(state, id)).filter((bot): bot is Bot => Boolean(bot));
