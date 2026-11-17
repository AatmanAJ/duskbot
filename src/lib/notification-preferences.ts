import { useSyncExternalStore } from "react";

export const NOTIFICATION_SOUNDS_KEY = "dusk-notification-sounds";
export const FINISHED_NOTIFICATIONS_KEY = "dusk-finished-notifications";

/** Per device: `bot` plays a sound unless the bot sent its notice quietly, `always` for every notice, `never` for none. */
export type NotificationSoundMode = "bot" | "always" | "never";
export const NOTIFICATION_SOUND_MODES: readonly NotificationSoundMode[] = ["bot", "always", "never"];

const STORED_MODE: Record<NotificationSoundMode, string> = { bot: "1", always: "always", never: "0" };
const modeOf = (stored: string | null | undefined): NotificationSoundMode => (stored === "0" ? "never" : stored === "always" ? "always" : "bot");

let sessionChoice: NotificationSoundMode | undefined;
let finishedSessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function notificationSoundMode(): NotificationSoundMode {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return modeOf(storage()?.getItem(NOTIFICATION_SOUNDS_KEY));
  } catch {
    return "bot";
  }
}

export function notificationSoundsEnabled(): boolean {
  return notificationSoundMode() !== "never";
}

/** Whether a notice plays a sound on this device: the person's setting first, then the bot's choice. */
export function notificationDings(notice: { silent?: boolean }): boolean {
  const mode = notificationSoundMode();
  return mode === "always" || (mode === "bot" && notice.silent !== true);
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== NOTIFICATION_SOUNDS_KEY && event.key !== FINISHED_NOTIFICATIONS_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  finishedSessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function setNotificationSoundMode(mode: NotificationSoundMode): void {
  sessionChoice = mode;
  try {
    const local = storage();
    const value = STORED_MODE[mode];
    local?.setItem(NOTIFICATION_SOUNDS_KEY, value);
    if (local?.getItem(NOTIFICATION_SOUNDS_KEY) === value) sessionChoice = undefined;
  } catch {
  }
  notify();
}

export function useNotificationSoundMode(): NotificationSoundMode {
  return useSyncExternalStore(subscribe, notificationSoundMode, () => "bot");
}

export function useNotificationSounds(): boolean {
  return useNotificationSoundMode() !== "never";
}

/** Per device: "done" notices only; approvals, questions and warnings always show. */
export function finishedNotificationsEnabled(): boolean {
  if (finishedSessionChoice !== undefined) return finishedSessionChoice;
  try {
    return storage()?.getItem(FINISHED_NOTIFICATIONS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setFinishedNotifications(enabled: boolean): void {
  finishedSessionChoice = enabled;
  try {
    const local = storage();
    const value = enabled ? "1" : "0";
    local?.setItem(FINISHED_NOTIFICATIONS_KEY, value);
    if (local?.getItem(FINISHED_NOTIFICATIONS_KEY) === value) finishedSessionChoice = undefined;
  } catch {
  }
  notify();
}

export function useFinishedNotifications(): boolean {
  return useSyncExternalStore(subscribe, finishedNotificationsEnabled, () => true);
}
