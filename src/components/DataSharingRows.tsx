import { t } from "@/lib/i18n";
import { PRIVACY_SUMMARY_URL, openExternalLink } from "@/lib/app-links";
import { useHelpImprove } from "@/lib/help-improve";
import { SettingRow, Switch } from "./SettingsPrimitives";

/** The single "help improve dusk bot" row: anonymous usage info, notes on how sessions went and crash reports, all
 * scrubbed on this computer first. On by default. */
export function DataSharingRows() {
  const { on, failed, set } = useHelpImprove("settings");
  if (on === null) return failed ? <p className="px-3 py-2 text-[13px] text-ink/60">{t("settings.dataSharing.unavailable")}</p> : null;
  return (
    <SettingRow icon="shield" title={t("settings.dataSharing.improve")} subtitle={<>
      {t("settings.dataSharing.improveHint")}
      <span className="mt-1 block">{t("settings.dataSharing.improveNote")}{" "}
        <button type="button" onClick={() => void openExternalLink(PRIVACY_SUMMARY_URL)}
          className="rounded-sm text-ink-secondary underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {t("settings.dataSharing.whatsShared")}
        </button>
      </span>
    </>}
      message={failed ? <p role="alert" className="text-danger">{t("settings.dataSharing.error")}</p> : null}>
      <Switch checked={on} aria-label={t("settings.dataSharing.improve")} onClick={() => void set(!on)} />
    </SettingRow>
  );
}
