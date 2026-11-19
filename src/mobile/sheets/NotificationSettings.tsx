import { useCallback, useEffect, useState } from "react";
import { BellOff, Smartphone } from "../../icons";
import { t } from "@/lib/i18n";
import { registerPushForConnection } from "../connection/push";
import { haptic } from "../haptics";
import { setLiveActivityEnabled, useLiveActivityEnabled } from "../live-activity-setting";
import { usePlatform } from "../platform";
import { SettingsRow, SettingsSwitch } from "./SettingsRow";

/** Reply notifications and the Live Activity are separate: turning the Live Activity off leaves the notifications on. */
export function NotificationSettings() {
  const platform = usePlatform();
  const liveActivity = useLiveActivityEnabled();
  const [permission, setPermission] = useState<"granted" | "denied" | "prompt" | null>(null);
  const check = useCallback(() => { void platform.pushPermission?.().then(setPermission); }, [platform]);
  useEffect(() => {
    check();
    return platform.onResume?.(check);
  }, [platform, check]);

  const allow = async () => {
    haptic("selection");
    if (permission === "denied") { await platform.camera?.openSettings?.(); return; }
    await registerPushForConnection(platform, { prompt: true });
    check();
  };

  return <>
    {permission && permission !== "granted" && (
      <SettingsRow icon={<BellOff />} label={t("mobile.settings.allowNotifications")} detail={t(permission === "denied" ? "mobile.settings.allowNotificationsDenied" : "mobile.settings.allowNotificationsDetail")} onClick={() => { void allow(); }} />
    )}
    {platform.turnActivity && (
      <SettingsSwitch icon={<Smartphone />} label={t("mobile.settings.liveActivity")} detail={t("mobile.settings.liveActivityDetail")} checked={liveActivity} onChange={(on) => { haptic("selection"); setLiveActivityEnabled(on); }} />
    )}
  </>;
}
