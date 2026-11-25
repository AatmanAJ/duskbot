/** The person's app preferences a bot may change when they ask (app_settings): the synced preference each one is kept
 * under, and the values the page accepts for it. */
export const APP_PREF_SETTINGS = {
  theme: { pref: "dusk-skin", values: ["system", "midnight", "atelier", "foundry", "lagoon", "graphite", "linen", "dusk", "daylight", "meadow", "pop", "grok", "grok-dark", "halloween", "signal", "signal-dark"] },
  font: { pref: "dusk-font", values: ["skin", "system", "inter", "poppins", "serif"] },
  chat_width: { pref: "dusk-chat-width", values: ["standard", "wide", "full"] },
  send_key: { pref: "dusk-send-key", values: ["enter", "shift-enter", "mod-enter"] },
  language: { pref: "dusk-language", values: ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pl", "pt-br", "ru", "tr", "uk", "vi", "zh", "zh-tw"] },
} as const;

export type AppPrefSetting = keyof typeof APP_PREF_SETTINGS;
export const APP_PREF_NAMES = Object.keys(APP_PREF_SETTINGS) as AppPrefSetting[];
export const isAppPrefSetting = (value: unknown): value is AppPrefSetting =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(APP_PREF_SETTINGS, value);
