import { useState } from "react";

import { t } from "@/lib/i18n";
import { api, useDispatch } from "@/state/store";
import { phoneAppChips, phonePlatformLabel, phoneRemovePath, usePhones } from "../lib/phones";
import { relative } from "./CompanionSection";
import { SettingRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { friendlyError } from "@/lib/plain-error";

export function PhonesList() {
  const { phase, phones, refresh } = usePhones();
  const dispatch = useDispatch();
  const [removing, setRemoving] = useState<string | null>(null);
  if (phase === "loading") return null;

  const remove = (key: string) => {
    if (removing) return;
    setRemoving(key);
    void api(phoneRemovePath(key), { method: "DELETE" })
      .catch((error: unknown) => dispatch({ type: "error", message: friendlyError(error) }))
      .finally(() => {
        setRemoving(null);
        refresh();
      });
  };

  if (phones.length === 0) return null;
  return (
    <SettingsGroup label={t("remote.phones.title")} block="phones">
      <SettingsRows>
        {phones.map((phone) => {
          const { name, platform } = phone.registration;
          const caps = phoneAppChips(phone).map((cap) => t(`botAccess.phone.cap.${cap}`));
          return (
            <SettingRow
              key={phone.key}
              icon="phone"
              title={`${name} · ${phonePlatformLabel(platform)}`}
              subtitle={[phone.online ? t("remote.phones.online") : t("remote.phones.offline", { when: relative(phone.seen) }), ...caps].join(" · ")}
            >
              <button type="button" disabled={removing !== null} onClick={() => remove(phone.key)} aria-label={t("remote.phones.remove", { name })} className="ui-button">
                {t("settings.w6.phone.remove")}
              </button>
            </SettingRow>
          );
        })}
      </SettingsRows>
    </SettingsGroup>
  );
}
