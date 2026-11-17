import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import {
  NOTIFICATION_SOUND_MODES,
  setFinishedNotifications,
  setNotificationSoundMode,
  useFinishedNotifications,
  useNotificationSoundMode,
  type NotificationSoundMode,
} from "@/lib/notification-preferences";
import { requestNotificationPermission } from "@/lib/notify";
import { chooseSound, chosenSound, play, soundChoice, SYSTEM_SOUND, systemSoundAvailable, UI_SOUND_NAMES, type SoundChoice, type UiSoundName } from "@/lib/ui-sounds";
import type { LocaleKey } from "@/locales";
import { SettingRow, Switch } from "./SettingsPrimitives";
import { SettingsSelect } from "./SettingsSelect";

export function NotificationRows() {
  return (
    <>
      <DeviceNotificationsRow />
      <NotificationSoundsRow />
      <NotificationSoundPickerRow />
    </>
  );
}

const currentPermission = (): NotificationPermission => (typeof Notification !== "undefined" ? Notification.permission : "default");

/** A browser shows nothing until it is asked from a click; the person may also change the site permission elsewhere. */
export function DeviceNotificationsRow() {
  const [permission, setPermission] = useState(currentPermission);
  const enabled = useFinishedNotifications();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setPermission(currentPermission());
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  if (typeof Notification === "undefined") return null;

  const blocked = permission === "denied";
  const toggle = async () => {
    if (permission === "granted") return setFinishedNotifications(!enabled);
    const next = await requestNotificationPermission();
    if (!next) return;
    setPermission(next);
    if (next === "granted") setFinishedNotifications(true);
  };

  return (
    <SettingRow
      icon="bell"
      title={t("settings.deviceNotifications.title")}
      subtitle={blocked ? t("settings.deviceNotifications.blocked") : undefined}
    >
      <Switch
        checked={permission === "granted" && enabled}
        disabled={blocked}
        aria-label={t("settings.deviceNotifications.show")}
        onClick={() => void toggle()}
      />
    </SettingRow>
  );
}

const MODE_LABELS: Record<NotificationSoundMode, LocaleKey> = {
  bot: "settings.notificationSound.modeBot",
  always: "settings.notificationSound.modeAlways",
  never: "settings.notificationSound.modeNever",
};

/** Per device: whether a bot's quiet notices (a receipt, a routine's "done") stay quiet, or the person's rule wins. */
function NotificationSoundsRow() {
  const mode = useNotificationSoundMode();
  return (
    <SettingRow
      icon="speaker"
      title={t("settings.notificationSound.playTitle")}
      subtitle={mode === "bot" ? t("settings.notificationSound.modeBotSubtitle") : undefined}
    >
      <SettingsSelect
        value={mode}
        aria-label={t("settings.notificationSounds.play")}
        options={NOTIFICATION_SOUND_MODES.map((value) => ({ value, label: t(MODE_LABELS[value]) }))}
        onChange={(event) => {
          const next = NOTIFICATION_SOUND_MODES.find((candidate) => candidate === event.target.value);
          if (!next) return;
          setNotificationSoundMode(next);
          if (mode === "never" && next !== "never" && soundChoice() !== SYSTEM_SOUND) play(chosenSound(), { force: true });
        }}
      />
    </SettingRow>
  );
}

const SOUND_LABELS: Record<UiSoundName, LocaleKey> = {
  "open-blip": "settings.notificationSound.openBlip",
  tick: "settings.notificationSound.tick",
  "double-tick": "settings.notificationSound.doubleTick",
  "chime-a": "settings.notificationSound.chimeA",
  "chime-b": "settings.notificationSound.chimeB",
};

/** Grok's ping picker: which of its five pings plays, heard once as it is chosen, or on the desktop app the system's own
 * banner sound, which follows Do Not Disturb. Hidden while sounds are off. */
export function NotificationSoundPickerRow() {
  const mode = useNotificationSoundMode();
  const [sound, setSound] = useState<SoundChoice>(soundChoice);
  if (mode === "never") return null;
  const choices: SoundChoice[] = systemSoundAvailable() ? [SYSTEM_SOUND, ...UI_SOUND_NAMES] : [...UI_SOUND_NAMES];
  return (
    <SettingRow icon="note" title={t("settings.notificationSound.title")}>
      <SettingsSelect
        value={sound}
        aria-label={t("settings.notificationSound.title")}
        options={choices.map((name) => ({ value: name, label: t(name === SYSTEM_SOUND ? "settings.notificationSound.system" : SOUND_LABELS[name]) }))}
        onChange={(event) => {
          const name = choices.find((candidate) => candidate === event.target.value);
          if (!name) return;
          chooseSound(name);
          setSound(name);
          if (name !== SYSTEM_SOUND) play(name, { force: true });
        }}
      />
    </SettingRow>
  );
}
